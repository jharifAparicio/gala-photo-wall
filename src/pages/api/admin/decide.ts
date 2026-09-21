import type { APIRoute } from 'astro';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDocClient, PHOTOS_TABLE } from '../../../lib/aws/dynamo';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
    try {
        const body = await request.json();
        const { photoId, action } = body;

        if (!photoId || !['APPROVE', 'ARCHIVE'].includes(action)) {
            return new Response(JSON.stringify({ error: 'Parámetros inválidos' }), { status: 400 });
        }

        const newStatus = action === 'APPROVE' ? 'APPROVED' : 'ARCHIVED';
        const moderator = locals.user?.username || 'admin';

        try {
            await dynamoDocClient.send(
                new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { photo_id: photoId },
                    UpdateExpression: 'SET #st = :newStatus, #mb = :moderator, #ma = :moderatedAt',
                    ConditionExpression: '#st = :pending', // Solo si sigue PENDING
                    ExpressionAttributeNames: {
                        '#st': 'status',
                        '#mb': 'moderated_by',
                        '#ma': 'moderated_at',
                    },
                    ExpressionAttributeValues: {
                        ':newStatus': newStatus,
                        ':moderator': moderator,
                        ':moderatedAt': Date.now(),
                        ':pending': 'PENDING',
                    },
                })
            );

            return new Response(JSON.stringify({ success: true, status: newStatus }), { status: 200 });
        } catch (dbError: any) {
            if (dbError.name === 'ConditionalCheckFailedException') {
                // Otro jurado tomó la decisión primero
                return new Response(
                    JSON.stringify({ success: true, ignored: true, message: 'Ya moderada previamente' }),
                    { status: 200 }
                );
            }
            throw dbError;
        }
    } catch (error) {
        console.error('Error al moderar foto:', error);
        return new Response(JSON.stringify({ error: 'Error interno de moderación' }), { status: 500 });
    }
};