/**
 * src/pages/api/video/download.ts
 * 
 * Endpoint para previsualizar y descargar el video generado desde el almacenamiento local del servidor.
 * Una vez completada la descarga, el archivo se elimina automáticamente para no ocupar disco.
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { videoQueue } from '../../../lib/videoQueue';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
    const jobId = url.searchParams.get('jobId');
    const isDownload = url.searchParams.get('download') === 'true';

    if (!jobId) {
        return new Response(JSON.stringify({ error: 'Parámetro jobId requerido.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const filePath = videoQueue.getLocalVideoPath(jobId);
    if (!filePath || !fs.existsSync(filePath)) {
        return new Response(
            JSON.stringify({
                error: 'El video no fue encontrado, ya fue descargado o expiró en el servidor.',
            }),
            {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // 1. Soporte de Range Requests para previsualización fluida en navegadores móviles (iOS/Android/Safari)
    const range = request.headers.get('range');
    if (range && !isDownload) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const fileStream = fs.createReadStream(filePath, { start, end });
        const headers = new Headers();
        headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Length', chunkSize.toString());
        headers.set('Content-Type', 'video/mp4');

        return new Response(fileStream as any, {
            status: 206, // Partial Content
            headers,
        });
    }

    // 2. Descarga completa o reproducción directa
    const fileStream = fs.createReadStream(filePath);

    // Si es acción de descarga explícita, eliminar el archivo tras finalizar la transferencia
    if (isDownload) {
        let deletionTriggered = false;
        const triggerCleanup = () => {
            if (deletionTriggered) return;
            deletionTriggered = true;
            // Margen de 3 segundos para que los buffers de red del socket se vacíen completamente hacia el cliente
            setTimeout(() => {
                videoQueue.deleteVideoFile(jobId);
            }, 3000);
        };

        fileStream.on('end', triggerCleanup);
        fileStream.on('close', triggerCleanup);
        fileStream.on('error', triggerCleanup);
    }

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Length', fileSize.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set(
        'Content-Disposition',
        isDownload
            ? 'attachment; filename="gala-recuerdo-2026.mp4"'
            : 'inline'
    );
    headers.set('Cache-Control', 'private, no-cache, no-store');

    return new Response(fileStream as any, {
        status: 200,
        headers,
    });
};
