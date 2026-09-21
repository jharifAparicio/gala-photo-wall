import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const s3Client = new S3Client({
    region: import.meta.env.AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: import.meta.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: import.meta.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

export const BUCKET_NAME = import.meta.env.S3_BUCKET_NAME || process.env.S3_BUCKET_NAME || '';

export async function createUploadPresignedUrl(key: string, contentType: string, expiresIn = 120): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
}