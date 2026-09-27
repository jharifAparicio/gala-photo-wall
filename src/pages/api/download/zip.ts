/**
 * src/pages/api/download/zip.ts
 * 
 * Endpoint de descarga masiva para el cierre del evento con control estricto de concurrencia.
 * 
 * Arquitectura:
 *   1. "Build Once, Serve Forever": NO empaqueta fotos. Sirve directamente el ZIP consolidado
 *      previamente generado en S3 (exports/gala-fotos-aprobadas.zip).
 *   2. Semáforo en memoria (downloadQueue): Máximo 5 descargas simultáneas para proteger CPU y RAM de t3.small.
 *   3. Encolamiento FIFO con Timeout (45s) y límite de cola (50 solicitudes).
 *   4. Streaming eficiente en chunks vía Web Streams / Bun sin almacenar el archivo en la RAM del servidor.
 *   5. Detección inmediata de desconexión / aborto del cliente para liberar slots y matar sockets S3.
 */

import type { APIRoute } from 'astro';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from '../../../lib/aws/s3';
import {
    downloadQueue,
    QueueTimeoutError,
    QueueFullError,
    QueueAbortError,
    type ReleaseFunction,
} from '../../../lib/downloadQueue';

export const prerender = false;

const S3_EXPORT_KEY = 'exports/gala-fotos-aprobadas.zip';
const ZIP_DOWNLOAD_FILENAME = 'gala-fotos-aprobadas.zip';

export const GET: APIRoute = async ({ request }) => {
    // 1. Verificación previa de existencia en S3 ("Build Once, Serve Forever")
    let contentLength: number | undefined;
    let etag: string | undefined;

    try {
        const head = await s3Client.send(
            new HeadObjectCommand({
                Bucket: BUCKET_NAME,
                Key: S3_EXPORT_KEY,
            })
        );
        contentLength = head.ContentLength;
        etag = head.ETag;
    } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
            return new Response(
                JSON.stringify({
                    error: 'El archivo ZIP consolidado aún no ha sido generado.',
                    detalle: 'El organizador debe ejecutar "bun run scripts/export-approved-zip.ts" primero.',
                }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        console.error('Error verificando existencia del ZIP en S3:', err);
        return new Response(
            JSON.stringify({ error: 'Error al consultar disponibilidad del archivo de descarga.' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    // 2. Control de Concurrencia y Semáforo FIFO (Máximo 5 simultáneos)
    let releaseSlot: ReleaseFunction | null = null;

    try {
        // Bloquea hasta obtener slot, o rechaza si se satura la cola o vence el timeout
        releaseSlot = await downloadQueue.acquireSlot(request.signal);
    } catch (queueErr: any) {
        const stats = downloadQueue.getStats();

        if (queueErr instanceof QueueTimeoutError || queueErr instanceof QueueFullError) {
            return new Response(
                JSON.stringify({
                    error: 'Hay demasiadas descargas en curso. Por favor, reintenta en un momento.',
                    motivo: queueErr.message,
                    descargasActivas: stats.active,
                    enEspera: stats.queued,
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': '25',
                    },
                }
            );
        }

        if (queueErr instanceof QueueAbortError) {
            // El cliente cerró la conexión mientras esperaba en cola
            return new Response(null, { status: 499 });
        }

        console.error('Error inesperado en gestor de concurrencia:', queueErr);
        return new Response(JSON.stringify({ error: 'Error interno en la cola de descarga' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 3. Obtención del stream desde S3 y canalización directa al cliente HTTP
    try {
        const s3Obj = await s3Client.send(
            new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: S3_EXPORT_KEY,
            })
        );

        if (!s3Obj.Body) {
            releaseSlot();
            return new Response(JSON.stringify({ error: 'Cuerpo de archivo S3 vacío' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Variable de guardia para asegurar liberación idempotente del slot
        let slotReleased = false;
        const safeRelease = () => {
            if (!slotReleased) {
                slotReleased = true;
                releaseSlot?.();
            }
        };

        // 4. Manejo de Aborto / Desconexión del cliente
        request.signal.addEventListener('abort', () => {
            safeRelease();
            // Destruir el socket S3 para no consumir ancho de banda innecesario en EC2
            if (typeof (s3Obj.Body as any)?.destroy === 'function') {
                (s3Obj.Body as any).destroy();
            }
        });

        // Escuchar eventos en el stream subyacente de Node/Bun
        if (typeof (s3Obj.Body as any)?.on === 'function') {
            const rawNodeStream = s3Obj.Body as any;
            rawNodeStream.on('close', safeRelease);
            rawNodeStream.on('end', safeRelease);
            rawNodeStream.on('error', () => {
                safeRelease();
            });
        }

        // Convertir a Web Standard Stream (ReadableStream) compatible con Bun/Astro
        const rawWebStream = (s3Obj.Body as any).transformToWebStream
            ? (s3Obj.Body as any).transformToWebStream()
            : (s3Obj.Body as any);

        // TransformStream para interceptar finalización y cancelación del lector Web
        const trackingStream = new TransformStream({
            transform(chunk, controller) {
                controller.enqueue(chunk);
            },
            flush() {
                safeRelease();
            },
            cancel() {
                safeRelease();
                if (typeof (s3Obj.Body as any)?.destroy === 'function') {
                    (s3Obj.Body as any).destroy();
                }
            },
        });

        const clientStream = rawWebStream.pipeThrough(trackingStream);

        // 5. Configuración de Headers requeridos
        const headers = new Headers();
        headers.set('Content-Type', 'application/zip');
        headers.set('Content-Disposition', `attachment; filename="${ZIP_DOWNLOAD_FILENAME}"`);
        if (contentLength) {
            headers.set('Content-Length', contentLength.toString());
        }
        if (etag) {
            headers.set('ETag', etag);
        }
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'private, no-transform, no-cache');
        headers.set('X-Active-Downloads', downloadQueue.getStats().active.toString());

        return new Response(clientStream, {
            status: 200,
            headers,
        });
    } catch (streamErr: any) {
        // Liberar slot inmediatamente si ocurrió un fallo al iniciar el stream
        releaseSlot();
        console.error('Error al transmitir ZIP desde S3:', streamErr);

        return new Response(
            JSON.stringify({ error: 'Fallo al iniciar la transmisión del archivo ZIP' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
};
