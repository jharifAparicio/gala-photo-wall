/**
 * src/lib/videoQueue.ts
 * 
 * Gestor de Cola de Renderizado de Video en Memoria para EC2 t3.small.
 * 
 * Restricciones de Arquitectura:
 * - t3.small posee 2 vCPUs y 2GB de RAM compartidos.
 * - Concurrencia de FFmpeg limitada estrictamente a 1 proceso activo a la vez (evita OOM killer y CPU starvation).
 * - Cola FIFO en memoria con límite de 15 solicitudes en espera.
 * - Limpieza de temporales y auto-purga de trabajos antiguos tras 1 hora.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { s3Client, BUCKET_NAME } from './aws/s3';
import { dynamoDocClient, PHOTOS_TABLE } from './aws/dynamo';
import { generateDevotionalPianoWav } from './audioGenerator';

export type VideoJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface VideoJob {
    id: string;
    status: VideoJobStatus;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    progress: number; // 0 a 100
    statusMessage: string;
    videoUrl?: string;
    localFilePath?: string;
    s3Key?: string;
    error?: string;
}

interface PhotoItem {
    photo_id: string;
    s3_key: string;
    author_name?: string;
    created_at?: number;
}

// Configuración de Concurrencia y Almacenamiento Local para t3.small
const MAX_CONCURRENT_RENDERS = 1;
const MAX_QUEUE_SIZE = 15;
const JOB_RETENTION_MS = 60 * 60 * 1000; // 1 hora en memoria
const TEMP_VIDEOS_DIR = path.resolve(process.cwd(), 'exports', 'temp_videos');
fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });

class VideoRenderQueueManager {
    private jobs = new Map<string, VideoJob>();
    private queue: string[] = [];
    private activeCount = 0;

    // Cache en memoria de fotos aprobadas (duración 3 minutos)
    private approvedPhotosCache: { photos: PhotoItem[]; timestamp: number } | null = null;
    private readonly CACHE_TTL_MS = 3 * 60 * 1000;

    constructor() {
        // Limpieza periódica de trabajos antiguos en memoria
        setInterval(() => this.purgeExpiredJobs(), 5 * 60 * 1000);
    }

    /**
     * Encola un nuevo trabajo de generación de video.
     */
    public enqueue(): VideoJob {
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            throw new Error('La cola de generación de video está saturada. Por favor, reintenta en unos minutos.');
        }

        const jobId = crypto.randomUUID();
        const job: VideoJob = {
            id: jobId,
            status: 'QUEUED',
            createdAt: Date.now(),
            progress: 0,
            statusMessage: 'En cola de espera para renderizado...',
        };

        this.jobs.set(jobId, job);
        this.queue.push(jobId);

        // Disparar procesamiento asíncrono
        queueMicrotask(() => this.processNext());

        return job;
    }

    /**
     * Consulta el estado de un trabajo.
     */
    public getJob(jobId: string): VideoJob | undefined {
        return this.jobs.get(jobId);
    }

    /**
     * Retorna posición en la fila para un trabajo encolado.
     */
    public getQueuePosition(jobId: string): number {
        const idx = this.queue.indexOf(jobId);
        return idx !== -1 ? idx + 1 : 0;
    }

    public getStats() {
        return {
            active: this.activeCount,
            queued: this.queue.length,
            totalInMemory: this.jobs.size,
            maxConcurrent: MAX_CONCURRENT_RENDERS,
        };
    }

    /**
     * Despacha el siguiente trabajo de la cola si hay capacidad disponible.
     */
    private async processNext(): Promise<void> {
        if (this.activeCount >= MAX_CONCURRENT_RENDERS || this.queue.length === 0) {
            return;
        }

        const jobId = this.queue.shift();
        if (!jobId) return;

        const job = this.jobs.get(jobId);
        if (!job) {
            this.processNext();
            return;
        }

        this.activeCount++;
        job.status = 'PROCESSING';
        job.startedAt = Date.now();
        job.progress = 5;
        job.statusMessage = 'Iniciando pipeline de renderizado...';

        try {
            await this.executeRenderPipeline(job);
            job.status = 'COMPLETED';
            job.progress = 100;
            job.completedAt = Date.now();
            job.statusMessage = '¡Video collage generado con éxito!';
        } catch (err: any) {
            console.error(`[VideoQueue] Error procesando job ${jobId}:`, err);
            job.status = 'FAILED';
            job.error = err.message || 'Error durante el procesamiento multimedia con FFmpeg';
            job.statusMessage = 'Fallo en la generación del video';
        } finally {
            this.activeCount--;
            this.processNext();
        }
    }

    /**
     * Pipeline completo: Selección aleatoria -> Descarga S3 -> FFmpeg render -> Subida S3
     */
    private async executeRenderPipeline(job: VideoJob): Promise<void> {
        const workDir = path.resolve(process.cwd(), 'exports', `video_job_${job.id}`);
        const outputMp4Path = path.join(workDir, 'collage.mp4');

        try {
            fs.mkdirSync(workDir, { recursive: true });

            // 1. Obtener fotos aprobadas (con caché)
            job.progress = 10;
            job.statusMessage = 'Obteniendo fotos aprobadas de la gala...';
            const allApproved = await this.getApprovedPhotos();

            if (allApproved.length === 0) {
                throw new Error('No hay fotos aprobadas disponibles para generar el video.');
            }

            // 2. Incluir todas las fotos aprobadas del evento (ordenadas cronológicamente)
            const selectedPhotos = [...allApproved].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

            // 3. Descarga concurrente de todas las fotos a directorio temporal
            job.progress = 20;
            job.statusMessage = `Descargando las ${selectedPhotos.length} fotos de la gala...`;
            const localImages: string[] = new Array(selectedPhotos.length);
            let downloadedCount = 0;

            const poolConcurrency = 6;
            let photoIndex = 0;
            const downloadWorkers = Array.from(
                { length: Math.min(poolConcurrency, selectedPhotos.length) },
                async () => {
                    while (photoIndex < selectedPhotos.length) {
                        const idx = photoIndex++;
                        const photo = selectedPhotos[idx];
                        const ext = path.extname(photo.s3_key) || '.webp';
                        const localImgPath = path.join(workDir, `img_${String(idx).padStart(4, '0')}${ext}`);

                        const s3Obj = await s3Client.send(
                            new GetObjectCommand({
                                Bucket: BUCKET_NAME,
                                Key: photo.s3_key,
                            })
                        );

                        if (!s3Obj.Body) {
                            throw new Error(`Objeto S3 vacío para ${photo.s3_key}`);
                        }

                        await pipeline(s3Obj.Body as NodeJS.ReadableStream, fs.createWriteStream(localImgPath));
                        localImages[idx] = localImgPath;
                        downloadedCount++;

                        const pct = Math.round(20 + (downloadedCount / selectedPhotos.length) * 20);
                        job.progress = pct;
                        job.statusMessage = `Descargando fotos (${downloadedCount}/${selectedPhotos.length})...`;
                    }
                }
            );

            await Promise.all(downloadWorkers);

            const validImages = localImages.filter(Boolean);
            if (validImages.length === 0) {
                throw new Error('No se pudo descargar ninguna imagen para el collage.');
            }

            // 3.1 Pre-procesamiento y normalización de imágenes a 720x1280 (Ahorra más del 70% de RAM en FFmpeg)
            job.progress = 35;
            job.statusMessage = 'Optimizando fotos para renderizado en memoria ligera...';
            const normalizedImages: string[] = [];
            for (let i = 0; i < validImages.length; i++) {
                const rawPath = validImages[i];
                const normPath = path.join(workDir, `norm_${String(i).padStart(4, '0')}.jpg`);
                await this.normalizeImage(rawPath, normPath);
                try {
                    fs.unlinkSync(rawPath); // Liberar espacio en disco inmediatamente
                } catch {}
                normalizedImages.push(normPath);

                const pct = Math.round(35 + ((i + 1) / validImages.length) * 10);
                job.progress = pct;
                job.statusMessage = `Optimizando fotos (${i + 1}/${validImages.length})...`;
            }

            // 4. Generar música instrumental devocional de piano única
            job.progress = 46;
            job.statusMessage = 'Generando música instrumental de piano personalizada...';
            const audioWavPath = path.join(workDir, 'piano_worship.wav');

            const durationPerSlide = normalizedImages.length > 15 ? 2.0 : 2.5;
            const transDuration = 0.5;
            const totalDuration =
                normalizedImages.length === 1
                    ? durationPerSlide
                    : normalizedImages.length * (durationPerSlide - transDuration) + transDuration;

            await generateDevotionalPianoWav(totalDuration, audioWavPath);

            // 5. Renderizado con FFmpeg (Video + Audio)
            job.progress = 50;
            job.statusMessage = `Renderizando video con música y ${normalizedImages.length} fotos...`;

            await this.renderVideoWithFfmpeg(normalizedImages, audioWavPath, outputMp4Path, (renderProgress) => {
                job.progress = Math.min(88, Math.round(50 + renderProgress * 0.38));
            });

            // 6. Guardado local temporal en el servidor (sin subir a S3 para no llenar el bucket)
            job.progress = 92;
            job.statusMessage = 'Preparando video para descarga directa...';

            fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });
            const finalLocalPath = path.join(TEMP_VIDEOS_DIR, `${job.id}.mp4`);
            fs.copyFileSync(outputMp4Path, finalLocalPath);

            job.localFilePath = finalLocalPath;
            job.videoUrl = `/api/video/download?jobId=${job.id}`;
            job.progress = 98;
            job.statusMessage = 'Finalizando...';
        } finally {
            // Limpieza estricta de archivos temporales en disco
            if (fs.existsSync(workDir)) {
                try {
                    fs.rmSync(workDir, { recursive: true, force: true });
                } catch (cleanupErr) {
                    console.warn(`[VideoQueue] Fallo al limpiar directorio ${workDir}:`, cleanupErr);
                }
            }
        }
    }

    /**
     * Pre-escala individualmente una imagen al formato 720x1280 con fondo elegante.
     * Esta técnica reduce drásticamente el consumo de memoria en FFmpeg al evitar
     * cargar y decodificar fotos originales de alta resolución (4K/12MP) en paralelo.
     */
    private normalizeImage(inputPath: string, outputPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const proc = spawn('ffmpeg', [
                '-y',
                '-i', inputPath,
                '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x09090b',
                '-q:v', '2',
                outputPath
            ]);

            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Error normalizando foto ${path.basename(inputPath)} (código ${code})`));
            });

            proc.on('error', (err) => {
                reject(new Error(`No se pudo ejecutar ffmpeg para optimizar la imagen: ${err.message}`));
            });
        });
    }

    /**
     * Ejecuta el comando FFmpeg optimizado para bajo consumo de recursos en t3.small.
     */
    private renderVideoWithFfmpeg(
        images: string[],
        audioPath: string,
        outputPath: string,
        onProgress: (pct: number) => void
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // Duración dinámica: 2.0s por foto si hay más de 15 fotos, o 2.5s si hay pocas
            const durationPerSlide = images.length > 15 ? 2.0 : 2.5;
            const transDuration = 0.5;
            const totalDuration =
                images.length === 1
                    ? durationPerSlide
                    : images.length * (durationPerSlide - transDuration) + transDuration;

            const args: string[] = ['-y'];

            // 1. Entradas de imágenes en bucle a 30 fps constantes (ya pre-escaladas a 720x1280)
            for (const imgPath of images) {
                args.push('-framerate', '30', '-loop', '1', '-t', durationPerSlide.toString(), '-i', imgPath);
            }

            // 2. Entrada de audio (pista de piano devocional generada proceduralmente)
            args.push('-i', audioPath);
            const audioInputIdx = images.length;

            // 3. Construcción de filter_complex (sin necesidad de cadenas pesadas de scale/pad por imagen)
            const filterChains: string[] = [];

            for (let i = 0; i < images.length; i++) {
                filterChains.push(
                    `[${i}:v]setsar=1,setpts=PTS-STARTPTS,fps=30[v${i}]`
                );
            }

            const textFilter =
                `drawtext=text='GALA JÓVENES EMBAJADORES 2026':` +
                `fontsize=26:fontcolor=0xfbbf24:x=(w-text_w)/2:y=90:shadowcolor=black@0.8:shadowx=2:shadowy=2,` +
                `drawtext=text='¡Gracias por ser parte de este momento!':` +
                `fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-130:shadowcolor=black@0.8:shadowx=2:shadowy=2`;

            if (images.length === 1) {
                // Caso especial: una sola foto
                filterChains.push(`[v0]${textFilter}[outv]`);
            } else {
                // Encadenamiento de transiciones xfade entre todas las fotos consecutivas
                let lastOutput = 'v0';
                for (let i = 1; i < images.length; i++) {
                    const nextOutput = i === images.length - 1 ? 'vxfade' : `vx${i}`;
                    const offset = (i * (durationPerSlide - transDuration)).toFixed(2);
                    filterChains.push(
                        `[${lastOutput}][v${i}]xfade=transition=fade:duration=${transDuration}:offset=${offset}[${nextOutput}]`
                    );
                    lastOutput = nextOutput;
                }

                filterChains.push(`[vxfade]${textFilter}[outv]`);
            }

            // Filtros de audio: calidez aterciopelada felt piano (corte a 1700Hz) + desvanecimiento suave
            const fadeInDuration = Math.min(2.0, Math.max(0.5, totalDuration * 0.1));
            const fadeOutDuration = Math.min(3.0, Math.max(0.5, totalDuration * 0.15));
            const fadeOutStart = Math.max(0, totalDuration - fadeOutDuration);

            filterChains.push(
                `[${audioInputIdx}:a]lowpass=f=1700,` +
                `volume=1.45,` +
                `afade=t=in:ss=0:d=${fadeInDuration.toFixed(2)},` +
                `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOutDuration.toFixed(2)}[aout]`
            );

            args.push(
                '-filter_complex', filterChains.join(';'),
                '-map', '[outv]',
                '-map', '[aout]',
                '-c:v', 'libx264',
                '-preset', 'veryfast',    // Minimiza uso de CPU y buffer de frames en RAM
                '-threads', '2',          // Ajustado exactamente a las 2 vCPUs de t3.small
                '-crf', '24',             // Calidad visual óptima para redes con peso ligero
                '-pix_fmt', 'yuv420p',    // Máxima compatibilidad móvil (iOS / Android)
                '-c:a', 'aac',            // Códec de audio universal para móviles
                '-b:a', '128k',
                '-shortest',
                '-movflags', '+faststart', // Reproducción inmediata sin esperar descarga total
                outputPath
            );

            const ffmpegProc = spawn('ffmpeg', args);
            let stderrData = '';

            ffmpegProc.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                stderrData += text;

                // Parsear progreso aproximado a partir de "time=00:00:05.20"
                const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                if (match) {
                    const hours = parseFloat(match[1]);
                    const mins = parseFloat(match[2]);
                    const secs = parseFloat(match[3]);
                    const currentSecs = hours * 3600 + mins * 60 + secs;
                    const pct = Math.min(100, Math.round((currentSecs / totalDuration) * 100));
                    onProgress(pct);
                }
            });

            ffmpegProc.on('close', (code, signal) => {
                if (code === 0) {
                    resolve();
                } else if (code === null) {
                    reject(
                        new Error(
                            `FFmpeg fue terminado inesperadamente por el sistema operativo (Signal: ${signal || 'SIGKILL'}/OOM). ` +
                            `El servidor se quedó sin memoria RAM física. Se recomienda configurar Swap de 2GB en la instancia EC2.`
                        )
                    );
                } else {
                    console.error('[FFMPEG ERROR FULL LOG]:\n', stderrData);
                    const relevantLines = stderrData
                        .split('\n')
                        .filter(l => l.includes('Error') || l.includes('error') || l.includes('Invalid') || l.includes('invalid') || l.includes('Failed') || l.startsWith('['))
                        .slice(-8)
                        .join(' | ');
                    reject(new Error(`FFmpeg finalizó con código de error ${code}. Log: ${relevantLines || stderrData.slice(-500)}`));
                }
            });

            ffmpegProc.on('error', (err) => {
                reject(new Error(`No se pudo iniciar el proceso FFmpeg: ${err.message}`));
            });
        });
    }

    /**
     * Consulta fotos aprobadas con almacenamiento en caché temporal.
     */
    private async getApprovedPhotos(): Promise<PhotoItem[]> {
        const now = Date.now();
        if (this.approvedPhotosCache && now - this.approvedPhotosCache.timestamp < this.CACHE_TTL_MS) {
            return this.approvedPhotosCache.photos;
        }

        const photos: PhotoItem[] = [];
        let lastKey: Record<string, any> | undefined = undefined;

        do {
            const res = await dynamoDocClient.send(
                new ScanCommand({
                    TableName: PHOTOS_TABLE,
                    FilterExpression: '#st = :approved',
                    ExpressionAttributeNames: { '#st': 'status' },
                    ExpressionAttributeValues: { ':approved': 'APPROVED' },
                    ProjectionExpression: 'photo_id, s3_key, author_name',
                    ExclusiveStartKey: lastKey,
                })
            );

            if (res.Items) {
                photos.push(...(res.Items as PhotoItem[]));
            }
            lastKey = res.LastEvaluatedKey;
        } while (lastKey);

        this.approvedPhotosCache = { photos, timestamp: now };
        return photos;
    }

    /**
     * Selección pseudo-aleatoria uniforme (algoritmo Fisher-Yates shuffle parcial).
     */
    private pickRandomPhotos(pool: PhotoItem[], count: number): PhotoItem[] {
        const copy = [...pool];
        const result: PhotoItem[] = [];
        const pickCount = Math.min(count, copy.length);

        for (let i = 0; i < pickCount; i++) {
            const randIdx = Math.floor(Math.random() * copy.length);
            result.push(copy[randIdx]);
            copy.splice(randIdx, 1);
        }

        return result;
    }

    /**
     * Retorna la ruta local del video generado si aún existe en disco.
     */
    public getLocalVideoPath(jobId: string): string | null {
        const job = this.jobs.get(jobId);
        if (job?.localFilePath && fs.existsSync(job.localFilePath)) {
            return job.localFilePath;
        }
        const fallbackPath = path.join(TEMP_VIDEOS_DIR, `${jobId}.mp4`);
        if (fs.existsSync(fallbackPath)) {
            return fallbackPath;
        }
        return null;
    }

    /**
     * Elimina el archivo local del video una vez que el usuario ha completado su descarga.
     */
    public deleteVideoFile(jobId: string): void {
        const filePath = this.getLocalVideoPath(jobId);
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`[VideoQueue] Video local eliminado tras descarga: ${filePath}`);
            } catch (err) {
                console.warn(`[VideoQueue] Error eliminando ${filePath}:`, err);
            }
        }
        const job = this.jobs.get(jobId);
        if (job) {
            job.localFilePath = undefined;
        }
    }

    private purgeExpiredJobs(): void {
        const now = Date.now();
        for (const [id, job] of this.jobs.entries()) {
            if (now - job.createdAt > JOB_RETENTION_MS) {
                this.deleteVideoFile(id);
                this.jobs.delete(id);
            }
        }

        // Limpieza de seguridad en disco para archivos huérfanos mayores a 15 minutos
        if (fs.existsSync(TEMP_VIDEOS_DIR)) {
            const files = fs.readdirSync(TEMP_VIDEOS_DIR);
            for (const file of files) {
                const fullPath = path.join(TEMP_VIDEOS_DIR, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (now - stat.mtimeMs > 15 * 60 * 1000) {
                        fs.unlinkSync(fullPath);
                        console.log(`[VideoQueue] Archivo huérfano purgado del disco: ${file}`);
                    }
                } catch {}
            }
        }
    }
}

// Singleton de cola de renderizado en memoria
export const videoQueue = new VideoRenderQueueManager();
