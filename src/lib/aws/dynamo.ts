import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const rawClient = new DynamoDBClient({
    region: import.meta.env.AWS_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: import.meta.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: import.meta.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

export const dynamoDocClient = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});

export const USERS_TABLE = import.meta.env.DYNAMO_TABLE_USERS || process.env.DYNAMO_TABLE_USERS || 'GalaUsers';
export const PHOTOS_TABLE = import.meta.env.DYNAMO_TABLE_PHOTOS || process.env.DYNAMO_TABLE_PHOTOS || 'GalaPhotos';