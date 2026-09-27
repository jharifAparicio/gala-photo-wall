import React, { useState, useEffect, useRef } from 'react';
import { Film, Sparkles, Download, RefreshCw, AlertCircle, Play, CheckCircle2 } from 'lucide-react';

type UIState = 'IDLE' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export default function VideoCollageGenerator() {
    const [state, setState] = useState<UIState>('IDLE');
    const [jobId, setJobId] = useState<string | null>(null);
    const [progress, setProgress] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [queuePosition, setQueuePosition] = useState<number>(0);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');

    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Detener polling al desmontar componente
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, []);

    const startPolling = (id: string) => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

        pollIntervalRef.current = setInterval(async () => {
            try {
                const res = await fetch(`/api/video/status?jobId=${id}`);
                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error('La tarea expiró o no fue encontrada.');
                    }
                    return;
                }

                const data = await res.json();
                setProgress(data.progress || 0);
                setStatusMessage(data.statusMessage || '');
                setQueuePosition(data.queuePosition || 0);

                if (data.status === 'PROCESSING') {
                    setState('PROCESSING');
                } else if (data.status === 'COMPLETED') {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                    setVideoUrl(data.videoUrl);
                    setState('COMPLETED');
                } else if (data.status === 'FAILED') {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                    setErrorMessage(data.error || 'Ocurrió un error en el renderizado.');
                    setState('FAILED');
                }
            } catch (err: any) {
                console.error('Error en sondeo de video:', err);
            }
        }, 1500);
    };

    const handleGenerate = async () => {
        setErrorMessage('');
        setProgress(0);
        setVideoUrl(null);
        setState('QUEUED');
        setStatusMessage('Conectando con la cola de renderizado...');

        try {
            const res = await fetch('/api/video/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            if (res.status === 429) {
                const data = await res.json();
                throw new Error(data.error || 'Demasiadas solicitudes simultáneas. Intenta en un momento.');
            }

            if (!res.ok) {
                throw new Error('Fallo al iniciar la generación del video.');
            }

            const data = await res.json();
            setJobId(data.jobId);
            setQueuePosition(data.queuePosition);
            startPolling(data.jobId);
        } catch (err: any) {
            setErrorMessage(err.message || 'Error al solicitar el video collage');
            setState('FAILED');
        }
    };

    const resetGenerator = () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setState('IDLE');
        setJobId(null);
        setProgress(0);
        setVideoUrl(null);
        setErrorMessage('');
    };

    return (
        <div className="w-full max-w-sm mx-auto flex flex-col items-center">
            {/* ESTADO 1: INICIAL (IDLE) */}
            {state === 'IDLE' && (
                <div className="w-full bg-neutral-900/60 border border-neutral-800 rounded-3xl p-6 backdrop-blur-md shadow-2xl flex flex-col items-center text-center space-y-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-amber-400/10 to-transparent border border-amber-400/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/10">
                        <Film className="w-8 h-8" />
                    </div>

                    <div className="space-y-1.5">
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 rounded-full">
                            <Sparkles className="w-3 h-3" /> Formato Vertical 9:16
                        </div>
                        <h3 className="text-lg font-black text-white tracking-tight">
                            Video Recuerdo Oficial
                        </h3>
                        <p className="text-xs text-neutral-400 leading-relaxed">
                            Crea un video collage conmemorativo en HD con todas las fotos aprobadas del evento, transiciones dinámicas y dedicatoria oficial.
                        </p>
                    </div>

                    <div className="w-full grid grid-cols-2 gap-2 text-left py-1 text-[11px] text-neutral-300">
                        <div className="flex items-center gap-1.5 bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-800/80">
                            <span className="text-amber-400 font-bold">🎬</span> Todas las fotos
                        </div>
                        <div className="flex items-center gap-1.5 bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-800/80">
                            <span className="text-amber-400 font-bold">📱</span> Reels & TikTok
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleGenerate}
                        className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:brightness-110 active:scale-95 text-neutral-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-xl shadow-amber-400/10 cursor-pointer"
                    >
                        <Sparkles className="w-4 h-4 fill-neutral-950" />
                        Generar mi Video Recuerdo
                    </button>
                </div>
            )}

            {/* ESTADO 2: EN COLA O PROCESANDO */}
            {(state === 'QUEUED' || state === 'PROCESSING') && (
                <div className="w-full bg-neutral-900/60 border border-neutral-800 rounded-3xl p-6 backdrop-blur-md shadow-2xl flex flex-col items-center text-center space-y-6">
                    <div className="relative flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full border-2 border-amber-400/20 border-t-amber-400 animate-spin flex items-center justify-center" />
                        <Film className="w-8 h-8 text-amber-400 absolute" />
                    </div>

                    <div className="space-y-2 w-full">
                        <h4 className="text-base font-bold text-white">
                            {state === 'QUEUED' ? 'Esperando turno en cola...' : 'Renderizando tu video...'}
                        </h4>
                        <p className="text-xs text-neutral-400">
                            {statusMessage || 'Preparando recursos en el servidor...'}
                        </p>

                        {state === 'QUEUED' && queuePosition > 0 && (
                            <span className="inline-block text-[11px] font-semibold text-amber-400/90 bg-amber-400/10 px-3 py-1 rounded-full border border-amber-400/20">
                                Tu posición en fila: #{queuePosition}
                            </span>
                        )}

                        {/* Barra de progreso */}
                        <div className="w-full bg-neutral-950 rounded-full h-2.5 overflow-hidden border border-neutral-800 mt-4">
                            <div
                                className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.max(5, progress)}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] text-neutral-500 font-mono pt-1">
                            <span>HD 1080x1920</span>
                            <span>{progress}%</span>
                        </div>
                    </div>

                    <p className="text-[11px] text-neutral-500 italic max-w-[260px]">
                        Por favor mantén esta pestaña abierta mientras FFmpeg compone tu video.
                    </p>
                </div>
            )}

            {/* ESTADO 3: COMPLETADO CON PREVIEW Y DESCARGA */}
            {state === 'COMPLETED' && videoUrl && (
                <div className="w-full bg-neutral-900/70 border border-neutral-800 rounded-3xl p-5 backdrop-blur-md shadow-2xl flex flex-col items-center space-y-4">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>¡Video Recuerdo Listo!</span>
                    </div>

                    {/* Reproductor Vertical 9:16 */}
                    <div className="relative w-full aspect-[9/16] max-w-[240px] rounded-2xl overflow-hidden bg-black border border-neutral-800 shadow-2xl">
                        <video
                            src={videoUrl}
                            controls
                            playsInline
                            autoPlay
                            loop
                            muted
                            className="w-full h-full object-cover"
                        />
                    </div>

                    <div className="w-full space-y-2 pt-2">
                        <a
                            href={`${videoUrl}&download=true`}
                            download="gala-recuerdo-2026.mp4"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:brightness-110 active:scale-95 text-neutral-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-xl shadow-amber-400/20 cursor-pointer"
                        >
                            <Download className="w-4 h-4" />
                            Descargar Video (MP4)
                        </a>

                        <p className="text-[10px] text-neutral-500 text-center">
                            El archivo temporal se eliminará del servidor una vez completada la descarga.
                        </p>

                        <button
                            type="button"
                            onClick={handleGenerate}
                            className="w-full py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Generar otro con fotos distintas
                        </button>
                    </div>
                </div>
            )}

            {/* ESTADO 4: ERROR */}
            {state === 'FAILED' && (
                <div className="w-full bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6 text-center space-y-4">
                    <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
                    <div>
                        <h4 className="text-sm font-bold text-white">No se pudo generar el video</h4>
                        <p className="text-xs text-rose-300/90 mt-1">{errorMessage}</p>
                    </div>
                    <button
                        type="button"
                        onClick={resetGenerator}
                        className="py-2.5 px-6 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-bold text-neutral-200 hover:bg-neutral-800 transition"
                    >
                        Intentar nuevamente
                    </button>
                </div>
            )}
        </div>
    );
}
