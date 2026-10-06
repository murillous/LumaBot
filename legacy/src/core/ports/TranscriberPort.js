/**
 * Porta de transcrição — contrato que todo adapter de transcrição de áudio deve satisfazer.
 * Abstrai Gemini, Whisper ou qualquer outro modelo de Speech-to-Text.
 */
export class TranscriberPort {
  /**
   * Transcreve um buffer de áudio para texto.
   *
   * @param {Buffer} audioBuffer - Conteúdo binário do áudio
   * @param {string} mimeType - Tipo MIME do áudio (ex: "audio/ogg; codecs=opus")
   * @returns {Promise<string|null>} Texto transcrito, ou null se todos os modelos falharem.
   *   Pode retornar strings especiais: "[áudio ininteligível]" ou "[áudio sem conteúdo]"
   */
  async transcribe(audioBuffer, mimeType) {
    throw new Error(`${this.constructor.name} não implementou TranscriberPort.transcribe()`);
  }
}
