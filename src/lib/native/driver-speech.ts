import { registerPlugin } from '@capacitor/core'
import { getPlatform, isPluginAvailable, waitForNativeBridge } from './platform'

type DriverSpeechPlugin = {
  speak(options: { text: string }): Promise<void>
  stop(): Promise<void>
}
// Fix: Capacitor captures plugin headers at registration time. Wait until the
// remote WebView has its native bridge before creating the speech proxy.
let driverSpeech: DriverSpeechPlugin | undefined
const getDriverSpeech = () => driverSpeech ??= registerPlugin<DriverSpeechPlugin>('DriverSpeech')

let promptGeneration = 0

export async function speakDriverNavigation(message: string): Promise<void> {
  const text = String(message || '').trim()
  if (!text || typeof window === 'undefined') return
  const generation = ++promptGeneration
  if (getPlatform() === 'android') {
    // Fix: use native speech in Android; WebView's speechSynthesis can be absent or silent.
    const ready = await waitForNativeBridge()
    if (generation !== promptGeneration) return
    if (!ready) throw new Error('Voice guidance is still connecting to the device. Please try again.')
    if (!isPluginAvailable('DriverSpeech')) throw new Error('Update the Driver app to enable native voice guidance.')
    await getDriverSpeech().speak({ text })
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
    void driverSpeech?.stop().catch(error => console.warn('Could not stop native voice guidance:', error))
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
