/**
 * src/lib/downloadQueue.ts
 * 
 * Gestor de Concurrencia y Semáforo FIFO en Memoria para Descargas Masivas en EC2 (t3.small).
 * 
 * Previene el colapso de RAM, CPU y saturación de ancho de banda limitando
 * el número de descargas simultáneas de archivos pesados (ZIPs) a un máximo estricto (por defecto 5).
 * Los usuarios adicionales esperan en cola con timeout configurable y liberación inmediata si cancelan.
 */

export class QueueTimeoutError extends Error {
    constructor(message = 'Tiempo de espera en cola excedido') {
        super(message);
        this.name = 'QueueTimeoutError';
    }
}

export class QueueFullError extends Error {
    constructor(message = 'La cola de descargas ha alcanzado su capacidad máxima') {
        super(message);
        this.name = 'QueueFullError';
    }
}

export class QueueAbortError extends Error {
    constructor(message = 'Petición abortada por el cliente') {
        super(message);
        this.name = 'QueueAbortError';
    }
}

export type ReleaseFunction = () => void;

interface QueueTicket {
    id: string;
    resolve: (release: ReleaseFunction) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    cleanupAbortListener?: () => void;
}

export class DownloadConcurrencyManager {
    private readonly maxConcurrent: number;
    private readonly maxQueueSize: number;
    private readonly timeoutMs: number;

    private activeSlots = 0;
    private waitingQueue: QueueTicket[] = [];

    /**
     * @param maxConcurrent Número máximo de descargas activas en paralelo (default: 5)
     * @param maxQueueSize Número máximo de peticiones esperando en la fila (default: 50)
     * @param timeoutMs Tiempo máximo de espera en cola antes de responder 429/503 (default: 45s)
     */
    constructor(maxConcurrent = 5, maxQueueSize = 50, timeoutMs = 45_000) {
        this.maxConcurrent = maxConcurrent;
        this.maxQueueSize = maxQueueSize;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Intenta adquirir un slot de descarga.
     * Si hay menos de `maxConcurrent` descargas activas, retorna de inmediato.
     * Si no, encola la petición respetando orden FIFO hasta que se libere un slot o venza el timeout.
     */
    public acquireSlot(signal?: AbortSignal): Promise<ReleaseFunction> {
        // 1. Si el cliente ya canceló la petición antes de ingresar
        if (signal?.aborted) {
            return Promise.reject(new QueueAbortError());
        }

        // 2. Si hay capacidad inmediata en el semáforo
        if (this.activeSlots < this.maxConcurrent) {
            this.activeSlots++;
            return Promise.resolve(this.createReleaseCallback());
        }

        // 3. Si la cola en memoria está saturada
        if (this.waitingQueue.length >= this.maxQueueSize) {
            return Promise.reject(
                new QueueFullError(`Cola llena (${this.waitingQueue.length}/${this.maxQueueSize}). Reintente más tarde.`)
            );
        }

        // 4. Encolar en FIFO con soporte de Timeout y AbortSignal
        return new Promise<ReleaseFunction>((resolve, reject) => {
            const ticketId = crypto.randomUUID();

            // Timeout de espera en cola
            const timer = setTimeout(() => {
                this.removeTicket(ticketId);
                reject(
                    new QueueTimeoutError(
                        `Tiempo de espera en cola (${Math.round(this.timeoutMs / 1000)}s) superado.`
                    )
                );
            }, this.timeoutMs);

            // Manejo de cancelación del cliente mientras espera en cola
            let cleanupAbortListener: (() => void) | undefined;
            if (signal) {
                const onAbort = () => {
                    clearTimeout(timer);
                    this.removeTicket(ticketId);
                    cleanupAbortListener?.();
                    reject(new QueueAbortError());
                };

                signal.addEventListener('abort', onAbort, { once: true });
                cleanupAbortListener = () => {
                    signal.removeEventListener('abort', onAbort);
                };
            }

            const ticket: QueueTicket = {
                id: ticketId,
                resolve: (rel) => {
                    clearTimeout(timer);
                    cleanupAbortListener?.();
                    resolve(rel);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    cleanupAbortListener?.();
                    reject(err);
                },
                timer,
                cleanupAbortListener,
            };

            this.waitingQueue.push(ticket);
        });
    }

    /**
     * Crea una función de liberación idempotente para un slot activo.
     */
    private createReleaseCallback(): ReleaseFunction {
        let called = false;
        return () => {
            if (called) return;
            called = true;
            this.dispatchNext();
        };
    }

    /**
     * Despacha el siguiente ticket en espera o decrementa el contador de slots activos.
     */
    private dispatchNext(): void {
        while (this.waitingQueue.length > 0) {
            const nextTicket = this.waitingQueue.shift();
            if (nextTicket) {
                // Cedemos el slot al siguiente cliente en la fila
                nextTicket.resolve(this.createReleaseCallback());
                return;
            }
        }

        // Si la cola está vacía, decrementamos el semáforo
        this.activeSlots = Math.max(0, this.activeSlots - 1);
    }

    /**
     * Remueve un ticket de la cola si venció su timeout o abortó la conexión.
     */
    private removeTicket(ticketId: string): void {
        const index = this.waitingQueue.findIndex((t) => t.id === ticketId);
        if (index !== -1) {
            this.waitingQueue.splice(index, 1);
        }
    }

    /**
     * Reporta métricas del estado actual de concurrencia.
     */
    public getStats(): {
        active: number;
        queued: number;
        maxConcurrent: number;
        maxQueueSize: number;
    } {
        return {
            active: this.activeSlots,
            queued: this.waitingQueue.length,
            maxConcurrent: this.maxConcurrent,
            maxQueueSize: this.maxQueueSize,
        };
    }
}

// Instancia singleton compartida en memoria del proceso Astro / Bun
export const downloadQueue = new DownloadConcurrencyManager(5, 50, 45_000);
