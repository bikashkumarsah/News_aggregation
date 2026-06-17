const SENTENCE_BOUNDARY = /(?<=[.!?।])\s+|\n+/u;

const splitNumberedSentences = (text, { limit = 40 } = {}) => String(text || '')
    .split(SENTENCE_BOUNDARY)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((value, index) => ({
        id: `S${index + 1}`,
        text: value
    }));

const formatNumberedSentences = (sentences) => (sentences || [])
    .map((sentence) => `[${sentence.id}] ${sentence.text}`)
    .join('\n');

const resolveEvidenceSentences = (ids, sentences) => {
    const byId = new Map((sentences || []).map((sentence) => [
        String(sentence.id),
        String(sentence.text || '')
    ]));
    return (Array.isArray(ids) ? ids : [])
        .map((id) => ({
            id: String(id),
            text: byId.get(String(id))
        }))
        .filter((item) => item.text);
};

module.exports = {
    formatNumberedSentences,
    resolveEvidenceSentences,
    splitNumberedSentences
};
