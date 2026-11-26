import { useEffect, useState } from 'react';

// "Listen": the browser reads a text aloud (the Web Speech API), in the page's language when it has such a voice.
// Long texts go sentence by sentence (some browsers stop long utterances half way).

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

const listeners = new Set<() => void>();
let speakingId: string | null = null;
const notify = () => listeners.forEach((listener) => listener());

function chunks(text: string) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["”»]?|\S[^.!?…]*$/g) ?? [text];
  const result: string[] = [];
  for (const sentence of sentences) {
    const last = result[result.length - 1];
    if (last && last.length + sentence.length < 220) result[result.length - 1] = `${last} ${sentence.trim()}`;
    else result.push(sentence.trim());
  }
  return result.filter(Boolean);
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  speakingId = null;
  window.speechSynthesis.cancel();
  notify();
}

/** Reads `text` aloud; `id` says what is being read (one thing at a time). */
export function speak(id: string, text: string, lang: string) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase())) ?? null;
  const parts = chunks(text);
  speakingId = id;
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = voice?.lang ?? lang;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.96;
    if (index === parts.length - 1) {
      utterance.onend = () => {
        if (speakingId === id) {
          speakingId = null;
          notify();
        }
      };
    }
    window.speechSynthesis.speak(utterance);
  });
  notify();
}

/** Whether `id` is being read right now. */
export function useSpeaking(id: string) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  // Leaving the page stops the reading.
  useEffect(() => () => {
    if (speakingId === id) stopSpeaking();
  }, [id]);
  return speakingId === id;
}
