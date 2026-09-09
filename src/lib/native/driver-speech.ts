import { registerPlugin } from '@capacitor/core'
import { getPlatform, isPluginAvailable, waitForNativeBridge } from './platform'

const DriverSpeech = registerPlugin<{
  speak(options: { text: string }): Promise<void>
  stop(): Promise<void>
}>('DriverSpeech')

let promptGeneration = 0

export async function speakDriverNavigation(message: string): Promise<void> {
  const text = String(message || '').trim()
  if (!text || typeof window === 'undefined') return
  const generation = ++promptGeneration
  if (getPlatform() === 'android') {
    // Fix: use native speech in Android; WebView's speechSynthesis can be absent or silent.
    await waitForNativeBridge()
    if (generation !== promptGeneration) return
    if (!isPluginAvailable('DriverSpeech')) throw new Error('Update the Driver app to enable native voice guidance.')
    await DriverSpeech.speak({ text })
    return
  }

  // Preserve the existing browser voice choice and playback behavior.
  if (!('speechSynthesis' in window)) return
  const synthesis = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-PH'
  utterance.rate = 1
  utterance.pitch = 1
  utterance.volume = 1
  const voices = synthesis.getVoices()
  const preferredVoice = voices.find(voice => /^en(-|_)?ph/i.test(voice.lang)) ||
    voices.find(voice => /^en(-|_)?us/i.test(voice.lang)) || voices.find(voice => /^en/i.test(voice.lang))
  if (preferredVoice) { utterance.voice = preferredVoice; utterance.lang = preferredVoice.lang }
  synthesis.cancel()
  synthesis.speak(utterance)
}

export function stopDriverNavigationSpeech(): void {
  // Invalidate any prompt still waiting for the bridge when muted or leaving the trip.
  promptGeneration++
  if (typeof window === 'undefined') return
  if (getPlatform() === 'android' && isPluginAvailable('DriverSpeech')) {
    void DriverSpeech.stop().catch(error => console.warn('Could not stop native voice guidance:', error))
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
