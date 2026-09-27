/**
 * scripts/export-approved-zip.ts
 * 
 * Script de generación única para el cierre del evento.
 * Diseñado específicamente para entornos con recursos limitados (AWS EC2 t3.small, 2GB RAM).
 * 
 * Ejecución:
 *   bun run scripts/export-approved-zip.ts
 * 
 * Flujo:
 *   1. Escanea DynamoDB paginado para recopilar fotos con status = 'APPROVED'.
 *   2. Descarga concurrentemente las fotos a ./exports/raw_photos (pool controlado de 8 descargas).
 *   3. Comprime por streams con archiver a ./exports/gala-fotos-aprobadas.zip.
 *   4. Sube por stream multipart a S3 en exports/gala-fotos-aprobadas.zip.
 *   5. Elimina los temporales locales y reporta métricas finales de peso y ubicación S3.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Upload } from '@aws-sdk/lib-storage';
import * as archiverModule from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// Helper para instanciar ZIP compatible tanto con Archiver v8 (ZipArchive) como v7 (función default)
function createZipStream(options: { zlib: { level: number } }) {
    if ((archiverModule as any).ZipArchive) {
        return new (archiverModule as any).ZipArchive(options);
    }
    const defaultFn = (archiverModule as any).default || archiverModule;
    return defaultFn('zip', options);
}

// --- CONFIGURACIÓN DE ENTORNO ---
const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'gala-photos-2026-sucre';
const PHOTOS_TABLE = process.env.DYNAMO_TABLE_PHOTOS || 'GalaPhotos';
const S3_EXPORT_KEY = 'exports/gala-fotos-aprobadas.zip';

// Directorios y rutas de exportación
const BASE_EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const RAW_PHOTOS_DIR = path.join(BASE_EXPORTS_DIR, 'raw_photos');
const LOCAL_ZIP_PATH = path.join(BASE_EXPORTS_DIR, 'gala-fotos-aprobadas.zip');

// Clientes AWS optimizados
const awsCredentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
};

const s3Client = new S3Client({
    region: REGION,
    credentials: awsCredentials,
});

const rawDynamo = new DynamoDBClient({
    region: REGION,
    credentials: awsCredentials,
});
const dynamoDocClient = DynamoDBDocumentClient.from(rawDynamo, {
    marshallOptions: { removeUndefinedValues: true },
});

interface PhotoRecord {
    photo_id: string;
    s3_key: string;
    author_name?: string;
    created_at?: number;
    status: string;
}

// Sanitizar nombres de archivo para empaquetado ZIP seguro
function sanitizeFilename(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 30);
}

// Concurrency Pool sin librerías externas para evitar consumo de memoria
async function runConcurrentPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    let index = 0;
    const workerPromises = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (index < items.length) {
                const currentIndex = index++;
                await worker(items[currentIndex], currentIndex);
            }
        }
    );
    await Promise.all(workerPromises);
}

async function main() {
    const startTime = Date.now();
    console.log('\n======================================================');
    console.log('   📸 GALA PHOTO WALL - EXPORTACIÓN FINAL DEL EVENTO   ');
    console.log('======================================================');
    console.log(`🌍 Región AWS:    ${REGION}`);
    console.log(`📦 Bucket S3:     ${BUCKET_NAME}`);
    console.log(`📊 Tabla Dynamo:  ${PHOTOS_TABLE}`);
    console.log(`📁 Destino S3:    ${S3_EXPORT_KEY}\n`);

    // 0. Preparar estructura de directorios
    fs.mkdirSync(RAW_PHOTOS_DIR, { recursive: true });

    // 1. Escanear DynamoDB con paginación
    console.log('🔍 Paso 1: Consultando fotos aprobadas en DynamoDB...');
    const approvedPhotos: PhotoRecord[] = [];
    let lastKey: Record<string, any> | undefined = undefined;
    let pageCount = 0;

    do {
        pageCount++;
        const scanResult = await dynamoDocClient.send(
            new ScanCommand({
                TableName: PHOTOS_TABLE,
                FilterExpression: '#st = :approved',
                ExpressionAttributeNames: { '#st': 'status' },
                ExpressionAttributeValues: { ':approved': 'APPROVED' },
                ExclusiveStartKey: lastKey,
            })
        );

        if (scanResult.Items) {
            approvedPhotos.push(...(scanResult.Items as PhotoRecord[]));
        }
        lastKey = scanResult.LastEvaluatedKey;
        process.stdout.write(`\r   Recuperadas ${approvedPhotos.length} fotos aprobadas (página ${pageCount})...`);
    } while (lastKey);

    console.log(`\n   ✅ Total de fotos aprobadas encontradas: ${approvedPhotos.length}`);

    if (approvedPhotos.length === 0) {
        console.log('⚠️ No hay fotos aprobadas para empaquetar. Abortando exportación.');
        return;
    }

    // 2. Descargar fotos a directorio temporal con control de concurrencia
    console.log('\n📥 Paso 2: Descargando fotos desde S3 con pool controlado (concurrencia: 8)...');
    let completedDownloads = 0;
    const downloadedFiles: { localPath: string; zipEntryName: string }[] = [];

    await runConcurrentPool(approvedPhotos, 8, async (photo, idx) => {
        const ext = path.extname(photo.s3_key) || '.webp';
        const author = sanitizeFilename(photo.author_name || 'Invitado');
        const fileName = `${String(idx + 1).padStart(4, '0')}_${author}_${photo.photo_id.slice(0, 8)}${ext}`;
        const localPath = path.join(RAW_PHOTOS_DIR, fileName);

        try {
            const s3Response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: photo.s3_key,
                })
            );

            if (!s3Response.Body) {
                throw new Error(`S3 Body vacío para clave: ${photo.s3_key}`);
            }

            const writeStream = fs.createWriteStream(localPath);
            await pipeline(s3Response.Body as NodeJS.ReadableStream, writeStream);

            downloadedFiles.push({
                localPath,
                zipEntryName: `fotos/${fileName}`,
            });

            completedDownloads++;
            const percent = ((completedDownloads / approvedPhotos.length) * 100).toFixed(1);
            process.stdout.write(`\r   Progreso descargas: [${completedDownloads}/${approvedPhotos.length}] (${percent}%)`);
        } catch (downloadErr: any) {
            console.error(`\n   ❌ Error descargando ${photo.s3_key}:`, downloadErr.message);
        }
    });

    console.log(`\n   ✅ Descarga completada exitosamente: ${downloadedFiles.length} fotos guardadas localmente.`);

    // 3. Comprimir fotos a archivo ZIP mediante streams
    console.log('\n🗜️ Paso 3: Generando archivo ZIP mediante streams (archiver zlib lvl 6)...');
    if (fs.existsSync(LOCAL_ZIP_PATH)) {
        fs.unlinkSync(LOCAL_ZIP_PATH);
    }

    const outputZipStream = fs.createWriteStream(LOCAL_ZIP_PATH);
    const archive = createZipStream({
        zlib: { level: 6 }, // Balance ideal de compresión y uso ligero de CPU para t3.small
    });

    const archivePromise = new Promise<void>((resolve, reject) => {
        outputZipStream.on('close', resolve);
        outputZipStream.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', (warn) => {
            if (warn.code === 'ENOENT') console.warn('   ⚠️ Alerta archiver:', warn);
            else reject(warn);
        });
    });

    archive.pipe(outputZipStream);

    // Añadir manifiesto descriptivo al ZIP
    const manifestContent = JSON.stringify(
        {
            evento: 'Gala Jóvenes Embajadores 2026',
            fecha_exportacion: new Date().toISOString(),
            total_fotos: downloadedFiles.length,
            archivo: 'gala-fotos-aprobadas.zip',
        },
        null,
        2
    );
    archive.append(manifestContent, { name: 'info_evento.json' });

    // Añadir todas las imágenes por streams
    for (const item of downloadedFiles) {
        archive.file(item.localPath, { name: item.zipEntryName });
    }

    await archive.finalize();
    await archivePromise;

    const zipStats = fs.statSync(LOCAL_ZIP_PATH);
    const zipSizeMB = (zipStats.size / (1024 * 1024)).toFixed(2);
    console.log(`   ✅ ZIP generado localmente: ${LOCAL_ZIP_PATH} (${zipSizeMB} MB)`);

    // 4. Subida directa por stream multipart a S3
    console.log('\n☁️ Paso 4: Subiendo archivo ZIP a Amazon S3...');
    const zipReadStream = fs.createReadStream(LOCAL_ZIP_PATH);

    const s3Upload = new Upload({
        client: s3Client,
        params: {
            Bucket: BUCKET_NAME,
            Key: S3_EXPORT_KEY,
            Body: zipReadStream,
            ContentType: 'application/zip',
            ContentDisposition: 'attachment; filename="gala-fotos-aprobadas.zip"',
        },
        // Configuración conservadora para 2GB de RAM (partes de 10MB, 2 paralelas)
        partSize: 10 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false,
    });

    s3Upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded && progress.total) {
            const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
            const loadedMB = (progress.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
            process.stdout.write(`\r   Subiendo a S3: ${percent}% (${loadedMB} MB / ${totalMB} MB)...`);
        }
    });

    await s3Upload.done();
    console.log(`\n   ✅ Subida a S3 completada: s3://${BUCKET_NAME}/${S3_EXPORT_KEY}`);

    // 5. Limpieza de fotos temporales locales
    console.log('\n🧹 Paso 5: Limpiando directorio temporal de fotos en bruto...');
    fs.rmSync(RAW_PHOTOS_DIR, { recursive: true, force: true });
    console.log('   ✅ Fotos temporales eliminadas. Espacio en disco liberado.');

    // Reporte Final
    const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${S3_EXPORT_KEY}`;

    console.log('\n======================================================');
    console.log('           🎉 EXPORTACIÓN FINALIZADA CON ÉXITO        ');
    console.log('======================================================');
    console.log(`⏱️ Tiempo total:      ${totalDurationSec} segundos`);
    console.log(`🖼️ Total fotos:       ${downloadedFiles.length}`);
    console.log(`📦 Peso final ZIP:    ${zipSizeMB} MB`);
    console.log(`🔗 S3 Key:            ${S3_EXPORT_KEY}`);
    console.log(`🌐 URL S3:            ${s3Url}`);
    console.log(`💾 Copia local:       ${LOCAL_ZIP_PATH}`);
    console.log('======================================================\n');
}

main().catch((error) => {
    console.error('\n❌ ERROR CRÍTICO DURANTE LA EXPORTACIÓN:', error);
    // Limpieza de emergencia si falló
    if (fs.existsSync(RAW_PHOTOS_DIR)) {
        try {
            fs.rmSync(RAW_PHOTOS_DIR, { recursive: true, force: true });
        } catch {}
    }
    process.exit(1);
});
