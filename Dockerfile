# Imagen base optimizada con Bun sobre Debian Bookworm
FROM oven/bun:1-debian

WORKDIR /app

# Instalar FFmpeg y dependencias del sistema requeridas para procesamiento multimedia
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Instalar dependencias con Bun usando el lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copiar el código fuente de la aplicación
COPY . .

# Compilar proyecto Astro SSR
ENV NODE_ENV=production
RUN bun run build

# Variables de entorno de red
ENV PORT=4321
ENV HOST=0.0.0.0

EXPOSE 4321

# Iniciar servidor standalone Astro con Bun
CMD ["bun", "./dist/server/entry.mjs"]
