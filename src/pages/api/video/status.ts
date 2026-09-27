/**
 * src/pages/api/video/status.ts
 * 
 * Endpoint para consultar el estado y progreso de renderizado de un video.
 */

import type { APIRoute } from 'astro';
import { videoQueue } from '../../../lib/videoQueue';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
        return new Response(
            JSON.stringify({ error: 'Parámetro jobId requerido.' }),
            {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    const job = videoQueue.getJob(jobId);

    if (!job) {
        return new Response(
            JSON.stringify({ error: 'Trabajo no encontrado o expirado por inactividad.' }),
            {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    return new Response(
        JSON.stringify({
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            statusMessage: job.statusMessage,
            videoUrl: job.videoUrl,
            error: job.error,
            queuePosition: videoQueue.getQueuePosition(job.id),
        }),
        {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, max-age=0',
            },
        }
    );
};
