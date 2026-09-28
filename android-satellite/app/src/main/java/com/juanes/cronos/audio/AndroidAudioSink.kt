package com.juanes.cronos.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Process
import android.util.Log
import xyz.gianlu.librespot.player.mixing.output.OutputAudioFormat
import xyz.gianlu.librespot.player.mixing.output.SinkOutput

/**
 * Receptor de audio de bajísima latencia para Librespot Spotify Connect.
 * Escribe muestras PCM de 16 bits directamente en el hardware de audio
 * mediante AudioTrack en modo STREAM a 44.1 kHz estéreo con cero asignación
 * de memoria por ciclo para minimizar el uso de RAM (<40 MB) y CPU.
 */
class AndroidAudioSink : SinkOutput {

    companion object {
        private const val TAG = "AndroidAudioSink"

        @Volatile
        var isPlaying: Boolean = false
            private set

        @Volatile
        var currentSink: AndroidAudioSink? = null
            private set
    }

    private var audioTrack: AudioTrack? = null
    private var bufferSizeInBytes: Int = 0
    private var prioritySet: Boolean = false

    init {
        currentSink = this
    }

    override fun start(format: OutputAudioFormat): Boolean {
        try {
            val sampleRate = format.sampleRate.toInt()
            val channelCount = format.channels
            val channelConfig = if (channelCount == 1) {
                AudioFormat.CHANNEL_OUT_MONO
            } else {
                AudioFormat.CHANNEL_OUT_STEREO
            }
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT

            val minBufferSize = AudioTrack.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            bufferSizeInBytes = (minBufferSize * 4).coerceAtLeast(8192)

            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()

            val formatSpec = AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setChannelMask(channelConfig)
                .setEncoding(audioFormat)
                .build()

            audioTrack?.release()
            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(formatSpec)
                .setBufferSizeInBytes(bufferSizeInBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            audioTrack?.play()
            isPlaying = true
            Log.i(TAG, "AudioTrack iniciado: ${sampleRate}Hz, $channelCount canales, buffer=$bufferSizeInBytes bytes")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error iniciando AudioTrack", e)
            isPlaying = false
            return false
        }
    }

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
        val track = audioTrack ?: return

        if (!prioritySet) {
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
                prioritySet = true
            } catch (e: Exception) {
                Log.w(TAG, "No se pudo fijar prioridad de audio urgente: ${e.message}")
            }
        }

        if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
            track.play()
        }

        var written = 0
        while (written < length) {
            val count = track.write(buffer, offset + written, length - written)
            if (count < 0) {
                Log.w(TAG, "Error en AudioTrack.write: $count")
                break
            }
            written += count
        }
    }

    override fun setVolume(volume: Float): Boolean {
        audioTrack?.let {
            val clamped = volume.coerceIn(0f, 1f)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                it.setVolume(clamped)
            } else {
                @Suppress("DEPRECATION")
                it.setStereoVolume(clamped, clamped)
            }
            return true
        }
        return false
    }

    override fun flush() {
        try {
            audioTrack?.flush()
        } catch (e: Exception) {
            Log.w(TAG, "Error en flush: ${e.message}")
        }
    }

    override fun stop() {
        isPlaying = false
        try {
            audioTrack?.pause()
        } catch (e: Exception) {
            Log.w(TAG, "Error en stop: ${e.message}")
        }
    }

    override fun drain() {
        // En AudioTrack STREAM no es necesario bloquear el hilo del decodificador
    }

    override fun release() {
        close()
    }

    override fun close() {
        isPlaying = false
        try {
            audioTrack?.let {
                if (it.state == AudioTrack.STATE_INITIALIZED) {
                    it.stop()
                    it.release()
                }
            }
            audioTrack = null
            Log.i(TAG, "AudioTrack liberado.")
        } catch (e: Exception) {
            Log.e(TAG, "Error cerrando AudioTrack", e)
        }
        if (currentSink == this) {
            currentSink = null
        }
    }
}
