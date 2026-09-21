import React, { useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { Check, X, Sparkles, RefreshCw, User } from 'lucide-react';

interface PendingPhoto {
    photo_id: string;
    view_url: string;
    author_name?: string;
    created_at: number;
}

export default function SwipeDeck() {
    const [photos, setPhotos] = useState<PendingPhoto[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchPending = async (isBackground = true) => {
        try {
            if (!isBackground) setLoading(true);
            const res = await fetch('/api/admin/pending');
            if (res.ok) {
                const data = await res.json();
                setPhotos(data.photos || []);
            }
        } catch (err) {
            console.error('Error cargando cola:', err);
        } finally {
            setLoading(false);
        }
    };

    // Sondeo inteligente dinámico según el estado de la bandeja
    useEffect(() => {
        fetchPending(false);

        const intervalTime = photos.length === 0 ? 15000 : 8000; // 15s si está vacío, 8s si hay fotos

        const timer = setInterval(() => {
            if (document.hidden) return;
            fetchPending(true);
        }, intervalTime);

        const handleVisibility = () => {
            if (!document.hidden) fetchPending(true);
        };

        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [photos.length]);

    const handleDecision = (photoId: string, action: 'APPROVE' | 'ARCHIVE') => {
        // 1. Optimistic UI: retirar de inmediato de la pantalla del jurado
        setPhotos((prev) => prev.filter((p) => p.photo_id !== photoId));

        // 2. Disparar actualización en segundo plano
        fetch('/api/admin/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoId, action }),
        }).catch((err) => console.error('Error enviando decisión:', err));
    };

    if (loading && photos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-400 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
                <p className="text-xs">Cargando fotos pendientes...</p>
            </div>
        );
    }

    if (photos.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-amber-400">
                    <Sparkles className="w-8 h-8" />
                </div>
                <div>
                    <h3 className="text-base font-bold text-neutral-200">Bandeja al día</h3>
                    <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                        No hay fotos pendientes de moderación en este momento. Las nuevas fotos aparecerán aquí automáticamente.
                    </p>
                </div>
                <button
                    onClick={fetchPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 transition"
                >
                    <RefreshCw className="w-3.5 h-3.5" /> Actualizar ahora
                </button>
            </div>
        );
    }

    const currentPhoto = photos[0];
    const nextPhoto = photos[1];

    return (
        <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-between h-[75vh]">
            {/* Contenedor de la pila de tarjetas */}
            <div className="relative w-full flex-1 flex items-center justify-center">
                {/* Tarjeta de fondo (siguiente en la cola) */}
                {nextPhoto && (
                    <div
                        className="absolute inset-0 rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-800 shadow-xl pointer-events-none scale-95 opacity-50 transition-all duration-300"
                        style={{ transformOrigin: 'bottom center' }}
                    >
                        <img src={nextPhoto.view_url} alt="Siguiente" className="w-full h-full object-cover" />
                    </div>
                )}

                {/* Tarjeta superior interactiva */}
                <AnimatePresence>
                    <SwipeCard
                        key={currentPhoto.photo_id}
                        photo={currentPhoto}
                        onDecide={(action) => handleDecision(currentPhoto.photo_id, action)}
                    />
                </AnimatePresence>
            </div>

            {/* Botones de acción manual por si no se desea deslizar */}
            <div className="flex items-center justify-center gap-8 py-4 w-full">
                <button
                    type="button"
                    onClick={() => handleDecision(currentPhoto.photo_id, 'ARCHIVE')}
                    className="w-16 h-16 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 active:scale-90 transition shadow-lg"
                    aria-label="Archivar foto"
                >
                    <X className="w-7 h-7" />
                </button>

                <button
                    type="button"
                    onClick={() => handleDecision(currentPhoto.photo_id, 'APPROVE')}
                    className="w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-400 flex items-center justify-center text-neutral-950 hover:brightness-110 active:scale-90 transition shadow-lg shadow-emerald-500/20"
                    aria-label="Aprobar para proyector"
                >
                    <Check className="w-8 h-8 stroke-[2.5]" />
                </button>
            </div>
        </div>
    );
}

function SwipeCard({
    photo,
    onDecide,
}: {
    photo: PendingPhoto;
    onDecide: (action: 'APPROVE' | 'ARCHIVE') => void;
}) {
    const x = useMotionValue(0);
    const rotate = useTransform(x, [-200, 200], [-18, 18]);
    const approveOpacity = useTransform(x, [20, 120], [0, 1]);
    const archiveOpacity = useTransform(x, [-20, -120], [0, 1]);

    const handleDragEnd = (_: any, info: any) => {
        const threshold = 100;
        const velocity = info.velocity.x;

        if (info.offset.x > threshold || velocity > 400) {
            onDecide('APPROVE');
        } else if (info.offset.x < -threshold || velocity < -400) {
            onDecide('ARCHIVE');
        }
    };

    return (
        <motion.div
            style={{ x, rotate }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.8}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-800 shadow-2xl cursor-grab active:cursor-grabbing touch-none select-none flex flex-col"
        >
            <div className="relative flex-1 w-full h-full bg-neutral-950">
                <img
                    src={photo.view_url}
                    alt="Foto para moderar"
                    className="w-full h-full object-cover pointer-events-none"
                />

                {/* Sello Dinámico: APROBAR (Verde) */}
                <motion.div
                    style={{ opacity: approveOpacity }}
                    className="absolute top-6 left-6 border-4 border-emerald-400 text-emerald-400 font-black text-xl px-4 py-1.5 rounded-xl uppercase tracking-widest -rotate-12 bg-neutral-950/60 backdrop-blur-sm"
                >
                    PROYECTAR
                </motion.div>

                {/* Sello Dinámico: ARCHIVAR (Gris/Rojo) */}
                <motion.div
                    style={{ opacity: archiveOpacity }}
                    className="absolute top-6 right-6 border-4 border-rose-500 text-rose-500 font-black text-xl px-4 py-1.5 rounded-xl uppercase tracking-widest rotate-12 bg-neutral-950/60 backdrop-blur-sm"
                >
                    ARCHIVAR
                </motion.div>

                {/* Info del autor en la base de la foto */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent p-5 pt-12 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center">
                        <User className="w-4 h-4" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-white leading-tight">
                            {photo.author_name || 'Invitado anónimo'}
                        </p>
                        <p className="text-[10px] text-neutral-400">Desliza derecha para aprobar</p>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}