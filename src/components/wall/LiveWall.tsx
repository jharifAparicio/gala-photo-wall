import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Maximize2, Minimize2, Sparkles, Camera } from 'lucide-react';

interface WallPhoto {
    photo_id: string;
    view_url: string;
    author_name: string;
    created_at: number;
}

interface Props {
    qrUrl: string;
}

export default function LiveWall({ qrUrl }: Props) {
    const [photos, setPhotos] = useState<WallPhoto[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. Cargar y sincronizar fotos aprobadas
    const fetchApprovedPhotos = async () => {
        try {
            const res = await fetch('/api/photos/approved');
            if (res.ok) {
                const data = await res.json();
                const incoming: WallPhoto[] = data.photos || [];

                setPhotos((prev) => {
                    if (incoming.length === 0) return prev;
                    // Evitar re-renders innecesarios si la lista no cambió
                    if (prev.length === incoming.length && prev[0]?.photo_id === incoming[0]?.photo_id) {
                        return prev;
                    }
                    return incoming;
                });
            }
        } catch (err) {
            console.error('Error al sincronizar muro:', err);
        }
    };

    useEffect(() => {
        fetchApprovedPhotos();
        // Sondeo cada 10 segundos para incorporar nuevas fotos al carrusel
        const syncTimer = setInterval(fetchApprovedPhotos, 10000);
        return () => clearInterval(syncTimer);
    }, []);

    // 2. Transición automática entre fotos (cada 7 segundos)
    useEffect(() => {
        if (photos.length <= 1) return;

        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % photos.length);
        }, 7000);

        return () => clearInterval(interval);
    }, [photos.length]);

    // 3. Manejo de pantalla completa
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(console.error);
            setIsFullscreen(true);
        } else {
            document.exitFullscreen().catch(console.error);
            setIsFullscreen(false);
        }
    };

    const currentPhoto = photos[currentIndex];

    return (
        <div
            ref={containerRef}
            className="relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none"
        >
            {/* Botón flotante para pantalla completa (oculto en proyector) */}
            <button
                onClick={toggleFullscreen}
                className="absolute top-4 right-4 z-50 p-2.5 rounded-full bg-neutral-900/60 hover:bg-neutral-800 text-neutral-400 hover:text-white backdrop-blur-md border border-neutral-800/60 transition opacity-20 hover:opacity-100"
                title="Pantalla Completa"
            >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>

            {/* Tarjeta flotante de Código QR para los invitados */}
            <div className="absolute bottom-8 right-8 z-40 bg-neutral-950/80 backdrop-blur-xl border border-neutral-800/80 rounded-3xl p-5 shadow-2xl flex items-center gap-4">
                <div className="bg-white p-2 rounded-2xl shadow-inner">
                    <QRCodeSVG value={qrUrl} size={110} level="M" />
                </div>
                <div className="max-w-[140px] text-left">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1">
                        <Camera className="w-3 h-3" /> En Vivo
                    </span>
                    <h4 className="text-sm font-black text-white leading-tight mt-1">¡Sube tu foto!</h4>
                    <p className="text-[11px] text-neutral-400 mt-1 leading-snug">
                        Apunta tu cámara al código y comparte tus momentos.
                    </p>
                </div>
            </div>

            {/* Contenido principal: Slideshow con Crossfade & Ken Burns */}
            {photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center space-y-4 z-10 p-6">
                    <div className="w-20 h-20 rounded-full bg-neutral-900/80 border border-neutral-800 flex items-center justify-center text-amber-400">
                        <Sparkles className="w-10 h-10 animate-pulse" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-white tracking-wide">
                            GALA JÓVENES EMBAJADORES 2026
                        </h2>
                        <p className="text-neutral-400 text-sm mt-2 max-w-md">
                            El muro está listo. Sé el primero en escanear el código QR y enviar tu foto a la pantalla.
                        </p>
                    </div>
                </div>
            ) : (
                <AnimatePresence mode="sync">
                    <motion.div
                        key={currentPhoto.photo_id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.2, ease: 'easeInOut' }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        {/* Imagen de fondo difuminada para llenar pantallas anchas sin dejar franjas grises */}
                        <div
                            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-30 scale-125"
                            style={{ backgroundImage: `url(${currentPhoto.view_url})` }}
                        />

                        {/* Imagen principal con animación de escala continua (Ken Burns) */}
                        <motion.img
                            src={currentPhoto.view_url}
                            alt="Foto Gala"
                            initial={{ scale: 1 }}
                            animate={{ scale: 1.05 }}
                            transition={{ duration: 7, ease: 'linear' }}
                            className="relative z-10 max-h-screen max-w-screen object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.9)]"
                        />

                        {/* Información del autor en la esquina inferior izquierda */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.8 }}
                            className="absolute bottom-8 left-8 z-30 bg-neutral-950/70 backdrop-blur-md border border-neutral-800/80 px-6 py-3.5 rounded-2xl flex items-center gap-3 shadow-2xl"
                        >
                            <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
                            <div>
                                <p className="text-xs text-neutral-400 uppercase tracking-widest font-semibold">
                                    Fotografía de
                                </p>
                                <p className="text-lg font-bold text-white leading-tight">
                                    {currentPhoto.author_name}
                                </p>
                            </div>
                        </motion.div>
                    </motion.div>
                </AnimatePresence>
            )}
        </div>
    );
}