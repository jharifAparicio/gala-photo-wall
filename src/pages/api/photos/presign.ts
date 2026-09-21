import type { APIRoute } from 'astro';
import { randomUUID } from 'crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDocClient, PHOTOS_TABLE } from '../../../lib/aws/dynamo';
import { createUploadPresignedUrl, BUCKET_NAME } from '../../../lib/aws/s3';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json().catch(() => ({}));
        const authorName = (body.authorName || 'Invitado').toString().trim().slice(0, 40);

        const photoId = randomUUID();
        const s3Key = `photos/${photoId}.webp`;
        const contentType = 'image/webp';

        // 1. Obtener URL prefirmada de S3 (válida por 2 minutos)
        const uploadUrl = await createUploadPresignedUrl(s3Key, contentType, 120);

        // 2. Registrar el ítem preliminar en DynamoDB con estado PENDING
        const region = import.meta.env.AWS_REGION || process.env.AWS_REGION || 'us-east-1';
        const publicUrl = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${s3Key}`;
        const timestamp = Date.now();

        await dynamoDocClient.send(
            new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: {
                    photo_id: photoId,
                    s3_key: s3Key,
                    url: publicUrl,
                    author_name: authorName,
                    status: 'PENDING',
                    created_at: timestamp,
                },
            })
        );

        return new Response(
            JSON.stringify({
                photoId,
                uploadUrl,
                publicUrl,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Error generando presigned URL:', error);
        return new Response(JSON.stringify({ error: 'No se pudo autorizar la subida' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};