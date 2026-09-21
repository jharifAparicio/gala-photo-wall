// scripts/seed-users.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMO_TABLE_USERS || 'GalaUsers';

// Cambia estas claves por las que quieras asignar
const judges = [
    { username: 'jharif', pass: 'Jharif2026!', name: 'Jharif Aparicio' },
    { username: 'daniel', pass: 'Daniel2026!', name: 'Daniel Aparicio' },
    { username: 'jurado1', pass: 'GalaJury01!', name: 'Jurado 1' },
    { username: 'jurado2', pass: 'GalaJury02!', name: 'Jurado 2' },
    { username: 'jurado3', pass: 'GalaJury03!', name: 'Jurado 3' },
];

async function seed() {
    console.log(`🌱 Sembrando 5 jurados en DynamoDB (${TABLE_NAME})...`);

    for (const user of judges) {
        const password_hash = await bcrypt.hash(user.pass, 10);
        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    username: user.username.toLowerCase().trim(),
                    password_hash,
                    name: user.name,
                    role: 'JURY',
                    created_at: Date.now(),
                },
            })
        );
        console.log(`✅ [${user.username}] creado exitosamente.`);
    }

    console.log('\n✨ Carga completa. Usuarios listos para autenticarse.');
}

seed().catch((err) => {
    console.error('❌ Error al sembrar usuarios:', err);
    process.exit(1);
});