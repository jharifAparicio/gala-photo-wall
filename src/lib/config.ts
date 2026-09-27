/**
 * Configuración general de la aplicación y del evento.
 */

/**
 * Determina si la subida de fotos está habilitada o bloqueada.
 * 
 * Por defecto está bloqueada (false) ya que el evento ha finalizado,
 * evitando que se continúe llenando el bucket S3 con nuevas fotos.
 * 
 * Para reactivarla si fuera necesario, configurar en .env:
 * UPLOADS_ENABLED=true o PUBLIC_UPLOADS_ENABLED=true
 */
export function areUploadsEnabled(): boolean {
    const rawVal =
        import.meta.env.UPLOADS_ENABLED ??
        process.env.UPLOADS_ENABLED ??
        import.meta.env.PUBLIC_UPLOADS_ENABLED ??
        process.env.PUBLIC_UPLOADS_ENABLED;

    if (rawVal === undefined || rawVal === null || rawVal === '') {
        // Por defecto: subida bloqueada para proteger el bucket
        return false;
    }

    return String(rawVal).trim().toLowerCase() === 'true';
}
