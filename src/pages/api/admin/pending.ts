import type { APIRoute } from 'astro';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDocClient, PHOTOS_TABLE } from '../../../lib/aws/dynamo';
import { createDownloadPresignedUrl } from '../../../lib/aws/s3';

export const prerender = false;

export const GET: APIRoute = async () => {
    try {
        const result = await dynamoDocClient.send(
            new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: 'StatusIndex',
                KeyConditionExpression: '#status = :status',
                ExpressionAttributeNames: {
                    '#status': 'status',
                },
                ExpressionAttributeValues: {
                    ':status': 'PENDING',
                },
                ScanIndexForward: true, // Orden cronológico (FIFO)
                Limit: 5,
            })
        );

        const items = result.Items || [];

        // Generar URLs firmadas de lectura para cada foto
        const photosWithUrls = await Promise.all(
            items.map(async (item) => {
                const viewUrl = await createDownloadPresignedUrl(item.s3_key);
                return {
                    ...item,
                    view_url: viewUrl,
                };
            })
        );

        return new Response(JSON.stringify({ photos: photosWithUrls }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error al obtener fotos pendientes:', error);
        return new Response(JSON.stringify({ error: 'Error al consultar fotos pendientes' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};