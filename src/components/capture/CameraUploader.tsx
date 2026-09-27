import React, { useState, useRef } from 'react';
import { Camera, Upload, CheckCircle2, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';
import { compressImage } from '../../lib/utils/image';

type UploadState = 'IDLE' | 'PREVIEW' | 'COMPRESSING' | 'UPLOADING' | 'SUCCESS' | 'ERROR';

export default function CameraUploader() {
    const [state, setState] = useState<UploadState>('IDLE');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [authorName, setAuthorName] = useState<string>('');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            setErrorMessage('Por favor selecciona un archivo de imagen válido.');
            setState('ERROR');
            return;
        }

        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setState('PREVIEW');
    };

    const resetFlow = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setSelectedFile(null);
        setErrorMessage('');
        setState('IDLE');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        try {
            // 1. Compresión en el cliente
            setState('COMPRESSING');
            const compressedBlob = await compressImage(selectedFile, 1920, 0.85);

            // 2. Pedir Presigned URL al servidor
            setState('UPLOADING');
            const presignRes = await fetch('/api/photos/presign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authorName: authorName.trim() || 'Invitado' }),
            });

            if (!presignRes.ok) {
                const errData = await presignRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al obtener permiso de subida del servidor');
            }

            const { uploadUrl } = await presignRes.json();

            // 3. Subida binaria directa a S3 mediante PUT
            const s3Res = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'image/webp',
                },
                body: compressedBlob,
            });

            if (!s3Res.ok) {
                throw new Error('Fallo al subir el archivo directo al almacenamiento');
            }

            setState('SUCCESS');
        } catch (err: any) {
            console.error(err);
            setErrorMessage(err.message || 'Ocurrió un error inesperado al enviar la foto');
            setState('ERROR');
        }
    };

    return (
        <div className="w-full max-w-sm mx-auto flex flex-col items-center">
            {/* Input oculto con trigger de cámara trasera en móviles */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
            />

            {state === 'IDLE' && (
                <div className="w-full flex flex-col items-center text-center space-y-6">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-44 h-44 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 p-1 shadow-2xl shadow-amber-500/20 active:scale-95 transition flex items-center justify-center group"
                    >
                        <div className="w-full h-full rounded-full bg-neutral-950 flex flex-col items-center justify-center p-4 group-hover:bg-neutral-900 transition">
                            <Camera className="w-12 h-12 text-amber-400 mb-2 group-hover:scale-110 transition" />
                            <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">Tomar Foto</span>
                        </div>
                    </button>

                    <p className="text-xs text-neutral-400 max-w-[260px]">
                        Presiona el círculo para abrir la cámara de tu celular y capturar el momento.
                    </p>
                </div>
            )}

            {state === 'PREVIEW' && previewUrl && (
                <div className="w-full flex flex-col space-y-4">
                    <div className="relative aspect-[3/4] w-full rounded-3xl overflow-hidden bg-neutral-900 border border-neutral-800 shadow-2xl">
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    </div>

                    <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                            Tu nombre o apodo (opcional)
                        </label>
                        <input
                            type="text"
                            maxLength={30}
                            placeholder="ej. Daniel A."
                            value={authorName}
                            onChange={(e) => setAuthorName(e.target.value)}
                            className="w-full bg-neutral-900/80 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-amber-400"
                        />
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={resetFlow}
                            className="flex-1 py-3 px-4 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 transition"
                        >
                            Reintentar
                        </button>
                        <button
                            type="button"
                            onClick={handleUpload}
                            className="flex-1 py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-neutral-950 text-xs font-bold flex items-center justify-center gap-2 transition active:scale-95 shadow-lg shadow-amber-400/10"
                        >
                            <Upload className="w-4 h-4" /> Enviar Foto
                        </button>
                    </div>
                </div>
            )}

            {(state === 'COMPRESSING' || state === 'UPLOADING') && (
                <div className="w-full py-16 flex flex-col items-center justify-center text-center space-y-4">
                    <RefreshCw className="w-10 h-10 text-amber-400 animate-spin" />
                    <p className="text-sm font-semibold text-neutral-200">
                        {state === 'COMPRESSING' ? 'Optimizando imagen...' : 'Subiendo a la pantalla gigante...'}
                    </p>
                    <p className="text-xs text-neutral-500">Un momento por favor</p>
                </div>
            )}

            {state === 'SUCCESS' && (
                <div className="w-full py-12 flex flex-col items-center justify-center text-center space-y-5 bg-neutral-900/40 border border-neutral-800/80 rounded-3xl p-6">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center justify-center gap-1.5">
                            ¡Foto Enviada! <Sparkles className="w-4 h-4 text-amber-400" />
                        </h3>
                        <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                            Tu foto ya está en la cola del evento. Atento a la pantalla grande durante la noche.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={resetFlow}
                        className="w-full py-3 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold transition"
                    >
                        Subir otra foto
                    </button>
                </div>
            )}

            {state === 'ERROR' && (
                <div className="w-full py-8 flex flex-col items-center justify-center text-center space-y-4 bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6">
                    <AlertCircle className="w-10 h-10 text-rose-400" />
                    <p className="text-xs text-rose-300">{errorMessage}</p>
                    <button
                        type="button"
                        onClick={resetFlow}
                        className="py-2.5 px-6 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-bold text-neutral-200 hover:bg-neutral-800 transition"
                    >
                        Volver a intentar
                    </button>
                </div>
            )}
        </div>
    );
}