/**
 * src/lib/audioGenerator.ts
 * 
 * Generador procedural de música instrumental suave, sutil y delicada para eventos cristianos.
 * Diseñado con una estética de "Felt Piano" (piano con sordina de fieltro) acompañado de
 * un cojín armónico celestial (ambient pad) de alabanza/adoración.
 * 
 * Evita totalmente el sonido sintético seco o tipo "Minecraft":
 * - Ataque ultrasuave (curva Hermite de 45ms sin chasquidos).
 * - Amortiguación armónica acelerada (los armónicos altos decaen en ~180ms, dejando un tono puro, cálido y aterciopelado).
 * - Pad orquestal suave de fondo que llena el espacio acústico con paz y solemnidad.
 * - Red de difusión de reverberación estéreo integrada.
 */

import fs from 'node:fs';

interface NoteDefinition {
    freq: number;
    startTime: number;
    duration: number;
    velocity: number;
    pan: number; // 0.0 (izquierda) a 1.0 (derecha)
}

function noteNameToFreq(note: string): number {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const name = note.slice(0, -1);
    const octave = parseInt(note.slice(-1), 10);
    const semitonesFromA4 = noteNames.indexOf(name) - 9 + (octave - 4) * 12;
    return 440 * Math.pow(2, semitonesFromA4 / 12);
}

interface KeyConfig {
    name: string;
    root: string;
    chords: {
        I: { root: string; third: string; fifth: string; octave: string };
        IV: { root: string; third: string; fifth: string; octave: string };
        V: { root: string; third: string; fifth: string; octave: string };
        vi: { root: string; third: string; fifth: string; octave: string };
    };
    pentatonicMelody: string[]; // Notas melódicas delicadas
}

const DEVOTIONAL_KEYS: KeyConfig[] = [
    {
        name: 'D Mayor (Esperanza y gratitud)',
        root: 'D',
        chords: {
            I: { root: 'D2', third: 'F#3', fifth: 'A3', octave: 'D4' },
            IV: { root: 'G2', third: 'B3', fifth: 'D4', octave: 'G4' },
            V: { root: 'A2', third: 'C#4', fifth: 'E4', octave: 'A4' },
            vi: { root: 'B2', third: 'D3', fifth: 'F#3', octave: 'B3' },
        },
        pentatonicMelody: ['D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'E5'],
    },
    {
        name: 'G Mayor (Paz y reverencia)',
        root: 'G',
        chords: {
            I: { root: 'G2', third: 'B2', fifth: 'D3', octave: 'G3' },
            IV: { root: 'C3', third: 'E3', fifth: 'G3', octave: 'C4' },
            V: { root: 'D3', third: 'F#3', fifth: 'A3', octave: 'D4' },
            vi: { root: 'E2', third: 'G3', fifth: 'B3', octave: 'E4' },
        },
        pentatonicMelody: ['G4', 'A4', 'B4', 'D5', 'E5', 'G5'],
    },
    {
        name: 'C Mayor (Pureza y consuelo)',
        root: 'C',
        chords: {
            I: { root: 'C2', third: 'E3', fifth: 'G3', octave: 'C4' },
            IV: { root: 'F2', third: 'A3', fifth: 'C4', octave: 'F4' },
            V: { root: 'G2', third: 'B3', fifth: 'D4', octave: 'G4' },
            vi: { root: 'A2', third: 'C3', fifth: 'E3', octave: 'A3' },
        },
        pentatonicMelody: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'],
    },
    {
        name: 'A Mayor (Alabanza solemne)',
        root: 'A',
        chords: {
            I: { root: 'A2', third: 'C#3', fifth: 'E3', octave: 'A3' },
            IV: { root: 'D3', third: 'F#3', fifth: 'A3', octave: 'D4' },
            V: { root: 'E3', third: 'G#3', fifth: 'B3', octave: 'E4' },
            vi: { root: 'F#2', third: 'A2', fifth: 'C#3', octave: 'F#3' },
        },
        pentatonicMelody: ['A4', 'B4', 'C#5', 'E5', 'F#5', 'A5'],
    },
];

// Progresiones clásicas de himnos de adoración
const WORSHIP_PROGRESSIONS: Array<Array<'I' | 'V' | 'vi' | 'IV'>> = [
    ['I', 'V', 'vi', 'IV'], // Alabanza dulce y contemplativa
    ['I', 'vi', 'IV', 'V'], // Paz profunda
    ['IV', 'I', 'V', 'vi'], // Himno espiritual
    ['I', 'IV', 'vi', 'V'], // Elevación y gratitud
];

export async function generateDevotionalPianoWav(durationSec: number, outputPath: string): Promise<string> {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * durationSec);
    const leftChannel = new Float32Array(numSamples);
    const rightChannel = new Float32Array(numSamples);

    // Selección aleatoria de tonalidad y progresión armónica
    const key = DEVOTIONAL_KEYS[Math.floor(Math.random() * DEVOTIONAL_KEYS.length)];
    const progression = WORSHIP_PROGRESSIONS[Math.floor(Math.random() * WORSHIP_PROGRESSIONS.length)];

    const chordDuration = 4.0; // 4 segundos por compás: ritmo pausado y contemplativo
    let currentTime = 0.0;
    let progressionIdx = 0;

    // --- CAPA 1: COJÍN CELESTIAL DE CUERDAS / PAD AMBIENTAL ---
    while (currentTime < durationSec) {
        const chordKey = progression[progressionIdx % progression.length];
        const chord = key.chords[chordKey];
        const segDuration = Math.min(chordDuration + 1.0, durationSec - currentTime);

        // Pad compuesto por tónica y quinta en registro medio
        addAmbientPad(
            leftChannel,
            rightChannel,
            sampleRate,
            noteNameToFreq(chord.root) * 2, // Octava 3
            currentTime,
            segDuration,
            0.11, // Nivel muy sutil (-19dB)
            0.4
        );
        addAmbientPad(
            leftChannel,
            rightChannel,
            sampleRate,
            noteNameToFreq(chord.fifth),
            currentTime,
            segDuration,
            0.08,
            0.6
        );

        currentTime += chordDuration;
        progressionIdx++;
    }

    // --- CAPA 2: PIANO FELT SUAVE Y DELICADO ---
    currentTime = 0.5; // Breve pausa inicial para respiración musical
    progressionIdx = 0;

    while (currentTime < durationSec - 2.5) {
        const chordKey = progression[progressionIdx % progression.length];
        const chord = key.chords[chordKey];

        // 1. Nota de bajo suave y profunda (fundamental)
        addFeltPianoNote(
            leftChannel,
            rightChannel,
            sampleRate,
            noteNameToFreq(chord.root),
            currentTime,
            chordDuration * 0.9,
            0.32,
            0.35
        );

        // 2. Quinta justa arpegiada con tacto ligero
        addFeltPianoNote(
            leftChannel,
            rightChannel,
            sampleRate,
            noteNameToFreq(chord.fifth),
            currentTime + 1.0,
            chordDuration * 0.7,
            0.24,
            0.45
        );

        // 3. Octava suave
        addFeltPianoNote(
            leftChannel,
            rightChannel,
            sampleRate,
            noteNameToFreq(chord.octave),
            currentTime + 2.0,
            chordDuration * 0.6,
            0.20,
            0.55
        );

        // 4. Melodía delicada en mano derecha (1 o 2 notas agudas con dinámica tenue)
        const melodyTime = currentTime + 1.4;
        if (melodyTime < durationSec - 3.0) {
            const randomMelodyNote = key.pentatonicMelody[Math.floor(Math.random() * key.pentatonicMelody.length)];
            addFeltPianoNote(
                leftChannel,
                rightChannel,
                sampleRate,
                noteNameToFreq(randomMelodyNote),
                melodyTime,
                2.2,
                0.22 + Math.random() * 0.08, // Dinámica sutil y humana
                0.62 + Math.random() * 0.1
            );
        }

        const secondMelodyTime = currentTime + 2.8;
        if (secondMelodyTime < durationSec - 3.0 && Math.random() > 0.3) {
            const secondNote = key.pentatonicMelody[Math.floor(Math.random() * key.pentatonicMelody.length)];
            addFeltPianoNote(
                leftChannel,
                rightChannel,
                sampleRate,
                noteNameToFreq(secondNote),
                secondMelodyTime,
                1.8,
                0.18 + Math.random() * 0.06,
                0.68
            );
        }

        currentTime += chordDuration;
        progressionIdx++;
    }

    // Acorde final de resolución suave en Tónica
    const finalChord = key.chords.I;
    const finalTime = Math.max(0, durationSec - 3.5);
    addFeltPianoNote(leftChannel, rightChannel, sampleRate, noteNameToFreq(finalChord.root), finalTime, 3.5, 0.28, 0.4);
    addFeltPianoNote(leftChannel, rightChannel, sampleRate, noteNameToFreq(finalChord.fifth), finalTime + 0.3, 3.2, 0.22, 0.5);
    addFeltPianoNote(leftChannel, rightChannel, sampleRate, noteNameToFreq(key.pentatonicMelody[0]), finalTime + 0.7, 2.8, 0.20, 0.6);

    // --- CAPA 3: DIFUSIÓN ACÚSTICA DE REVERBERACIÓN DE CAPILLA ---
    applySanctuaryDiffusion(leftChannel, rightChannel, sampleRate);

    // Empaquetar a archivo WAV estéreo 16-bit
    const headerBuffer = Buffer.alloc(44);
    headerBuffer.write('RIFF', 0);
    headerBuffer.writeUInt32LE(36 + numSamples * 4, 4);
    headerBuffer.write('WAVE', 8);
    headerBuffer.write('fmt ', 12);
    headerBuffer.writeUInt32LE(16, 16);
    headerBuffer.writeUInt16LE(1, 20);            // PCM
    headerBuffer.writeUInt16LE(2, 22);            // 2 canales estéreo
    headerBuffer.writeUInt32LE(sampleRate, 24);   // 44100 Hz
    headerBuffer.writeUInt32LE(sampleRate * 4, 28);
    headerBuffer.writeUInt16LE(4, 32);
    headerBuffer.writeUInt16LE(16, 34);           // 16 bits
    headerBuffer.write('data', 36);
    headerBuffer.writeUInt32LE(numSamples * 4, 40);

    const dataBuffer = Buffer.alloc(numSamples * 4);
    for (let i = 0; i < numSamples; i++) {
        const leftSample = Math.max(-0.95, Math.min(0.95, leftChannel[i]));
        const rightSample = Math.max(-0.95, Math.min(0.95, rightChannel[i]));

        dataBuffer.writeInt16LE(Math.floor(leftSample * 32767), i * 4);
        dataBuffer.writeInt16LE(Math.floor(rightSample * 32767), i * 4 + 2);
    }

    const fullWav = Buffer.concat([headerBuffer, dataBuffer]);
    fs.writeFileSync(outputPath, fullWav);

    return outputPath;
}

/**
 * Síntesis de nota de Felt Piano (piano de fieltro íntimo, suave y sin chasquidos).
 */
function addFeltPianoNote(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
    freq: number,
    startTime: number,
    duration: number,
    velocity: number,
    pan: number
) {
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(left.length, startSample + Math.floor(duration * sampleRate));
    const attackSamples = Math.floor(0.045 * sampleRate); // 45ms de ataque curvo y mullido

    for (let i = startSample; i < endSample; i++) {
        const t = (i - startSample) / sampleRate;

        // Envolvente Hermite ultrasuave (elimina cualquier chasquido o sonido seco digital)
        let env = 0;
        if (i - startSample < attackSamples) {
            const x = (i - startSample) / attackSamples;
            env = x * x * (3 - 2 * x); // S-curve smoothstep
        } else {
            env = Math.exp(-t * 0.92); // Decaimiento suave y natural de cuerda acústica
        }

        // Amortiguación rápida de armónicos superiores (clave para el timbre cálido 'felt')
        const dampH2 = Math.exp(-t * 3.8);
        const dampH3 = Math.exp(-t * 6.5);

        const fundamental = Math.sin(2 * Math.PI * freq * t);
        const harmonic2 = 0.18 * Math.sin(2 * Math.PI * freq * 2 * t) * dampH2;
        const harmonic3 = 0.04 * Math.sin(2 * Math.PI * freq * 3 * t) * dampH3;
        const subBody = 0.06 * Math.sin(2 * Math.PI * (freq * 0.5) * t); // Resonancia de caja

        const sampleVal = (fundamental + harmonic2 + harmonic3 + subBody) * env * velocity * 0.28;

        left[i] += sampleVal * (1 - pan * 0.4);
        right[i] += sampleVal * (0.6 + pan * 0.4);
    }
}

/**
 * Cojín armónico celestial (Ambient worship pad).
 */
function addAmbientPad(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
    freq: number,
    startTime: number,
    duration: number,
    velocity: number,
    pan: number
) {
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(left.length, startSample + Math.floor(duration * sampleRate));
    const attackSamples = Math.floor(1.1 * sampleRate); // Entrada lenta de 1.1s (hinchazón suave)

    for (let i = startSample; i < endSample; i++) {
        const t = (i - startSample) / sampleRate;

        let env = 0;
        if (i - startSample < attackSamples) {
            const x = (i - startSample) / attackSamples;
            env = x * x * (3 - 2 * x);
        } else if (i > endSample - attackSamples) {
            const x = (endSample - i) / attackSamples;
            env = x * x * (3 - 2 * x);
        } else {
            env = 1.0;
        }

        // Dos senoidales ligeramente desafinadas para dar sensación de calidez orquestal
        const w1 = Math.sin(2 * Math.PI * freq * t);
        const w2 = 0.25 * Math.sin(2 * Math.PI * (freq * 1.0015) * t);

        const sampleVal = (w1 + w2) * env * velocity * 0.16;

        left[i] += sampleVal * (1 - pan * 0.35);
        right[i] += sampleVal * (0.65 + pan * 0.35);
    }
}

/**
 * Difusión estéreo de reverberación espacial (ambiente de iglesia/santuario).
 */
function applySanctuaryDiffusion(left: Float32Array, right: Float32Array, sampleRate: number) {
    const delays = [
        Math.floor(0.097 * sampleRate),
        Math.floor(0.149 * sampleRate),
        Math.floor(0.211 * sampleRate),
        Math.floor(0.283 * sampleRate),
    ];
    const feedbacks = [0.28, 0.22, 0.16, 0.11];

    for (let d = 0; d < delays.length; d++) {
        const delay = delays[d];
        const fb = feedbacks[d];
        for (let i = delay; i < left.length; i++) {
            const wetL = left[i - delay] * fb;
            const wetR = right[i - delay] * fb;
            left[i] += (d % 2 === 0 ? wetL : wetR) * 0.20;
            right[i] += (d % 2 === 0 ? wetR : wetL) * 0.20;
        }
    }
}
