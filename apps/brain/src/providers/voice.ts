import { config } from "../env.ts";

/**
 * Voice.
 *
 * The hands-full problem is real: you are holding a jacket, a phone, and a
 * hanger in a rack that is 40cm wide. Typing is not happening. So you talk.
 *
 *   transcribe()  — speech → text → straight into the identification step
 *   speak()       — verdict → speech, so you can keep your eyes on the rack
 *
 * ElevenLabs is cloud-only and therefore optional by definition. The app never
 * depends on it; when the key is absent, the mic button simply is not offered.
 */

export function hasVoice(): boolean {
  return Boolean(config.elevenlabs.apiKey);
}

export async function transcribe(audio: Blob | Buffer, filename = "note.webm"): Promise<string> {
  if (!config.elevenlabs.apiKey) throw new Error("ELEVENLABS_API_KEY not set");
  const form = new FormData();
  const blob =
    audio instanceof Blob ? audio : new Blob([new Uint8Array(audio)], { type: "audio/webm" });
  form.append("file", blob, filename);
  form.append("model_id", "scribe_v1");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabs.apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`elevenlabs stt ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

export async function speak(text: string): Promise<Buffer> {
  if (!config.elevenlabs.apiKey) throw new Error("ELEVENLABS_API_KEY not set");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenlabs.ttsVoice)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenlabs.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`elevenlabs tts ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
