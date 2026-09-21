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
                    ':status': 'APPROVED',
                },
                ScanIndexForward: false, // Las más recientes primero
                Limit: 40,
            })
        );

        const items = result.Items || [];

        const photosWithUrls = await Promise.all(
            items.map(async (item) => {
                const viewUrl = await createDownloadPresignedUrl(item.s3_key);
                return {
                    photo_id: item.photo_id,
                    view_url: viewUrl,
                    author_name: item.author_name || 'Invitado',
                    created_at: item.created_at,
                };
            })
        );

        return new Response(JSON.stringify({ photos: photosWithUrls }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error al obtener fotos del muro:', error);
        return new Response(JSON.stringify({ error: 'Error al consultar fotos aprobadas' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};