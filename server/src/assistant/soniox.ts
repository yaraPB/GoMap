/** Recorded speech transcription. The API key never leaves the server. */
export async function transcribeSoniox(audio: Buffer, mime: string, lang: string, key: string, model: string, fetcher: typeof fetch = fetch): Promise<string> {
  const base = 'https://api.soniox.com/v1';
  const headers = { Authorization: `Bearer ${key}` };
  let fileId = '', jobId = '', terminal = false;
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetcher(base + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Soniox request failed (${response.status}).`);
    return response;
  };
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), mime.includes('webm') ? 'question.webm' : 'question.m4a');
    fileId = ((await (await request('/files', { method: 'POST', body: form })).json()) as { id: string }).id;
    jobId = ((await (await request('/transcriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, file_id: fileId, language_hints: [lang], context: { terms: ['GoMap', 'AUI', 'Al Akhawayn', 'Ifrane', 'registrar'] } }) })).json()) as { id: string }).id;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const job = await (await request(`/transcriptions/${encodeURIComponent(jobId)}`)).json() as { status: string };
      if (job.status === 'error') { terminal = true; throw new Error('Soniox could not transcribe this recording.'); }
      if (job.status === 'completed') {
        terminal = true;
        const result = await (await request(`/transcriptions/${encodeURIComponent(jobId)}/transcript`)).json() as { text: string };
        return result.text.trim();
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Transcription timed out. Please try again.');
  } finally {
    // Do not delete a file while a job is still processing; Soniox expires it automatically.
    if (terminal && jobId) await request(`/transcriptions/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {});
    if ((terminal || !jobId) && fileId) await request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => {});
  }
}
