const store = [];

/**
 * @param {{ id: string, content: string, embedding: number[], metadata?: Record<string, unknown> }} item
 */
export function add(item) {
  store.push(item);
  return item.id;
}

/**
 * @param {number[]} queryEmbedding
 * @param {{ cosineSimilarity: (a: number[], b: number[]) => number }} similarityFn
 * @param {number} topK
 * @returns {{ content: string, metadata?: Record<string, unknown> }[]}
 */
export function query(queryEmbedding, similarityFn, topK = 5) {
  const scored = store.map((item) => ({
    ...item,
    similarity: similarityFn(queryEmbedding, item.embedding),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK).map(({ content, metadata }) => ({ content, metadata }));
}

export function size() {
  return store.length;
}

/**
 * 返回当前内存向量库的浅拷贝，仅用于调试与可视化。
 *
 * 如果未来需要接入持久化向量库（如 Upstash Vector / Supabase pgvector 等），
 * 可以在此文件中替换实现：
 * - 将上方的 `store` 数组替换为远程向量库的读写调用；
 * - `add` 函数改为写入远程向量库；
 * - `query` 函数改为调用远程相似度搜索接口；
 * - `size` 与 `getAll` 用于调试与 /api/debug-memories，可从远程库中返回统计信息与最近若干条记录。
 *
 * 这样可以在不改动 api/embed-and-store 与 api/retrieve 调用方式的前提下，
 * 平滑切换到真正的持久化 RAG 记忆池。
 * 不要在调用方修改返回数组中的元素。
 */
export function getAll() {
  return [...store];
}
