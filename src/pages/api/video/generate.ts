/**
 * src/pages/api/video/generate.ts
 * 
 * Endpoint para solicitar la generación asíncrona de un video collage conmemorativo.
 */

import type { APIRoute } from 'astro';
import { videoQueue } from '../../../lib/videoQueue';

export const prerender = false;

export const POST: APIRoute = async () => {
    try {
        const job = videoQueue.enqueue();
        const queuePos = videoQueue.getQueuePosition(job.id);

        return new Response(
            JSON.stringify({
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                queuePosition: queuePos,
                message: 'Tu video collage ha sido encolado para renderizado.',
            }),
            {
                status: 202, // 202 Accepted
                headers: { 'Content-Type': 'application/json' },
            }
        );
    } catch (err: any) {
        return new Response(
            JSON.stringify({
                error: err.message || 'La cola de renderizado está saturada. Intenta más tarde.',
                retryAfter: 30,
            }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '30',
                },
            }
        );
    }
};
