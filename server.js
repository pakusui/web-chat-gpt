require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { OpenAI } = require('openai');
const { google } = require('googleapis');

const app = express();
const port = process.env.PORT || 3000;

// ===== OpenAI =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // 必要に応じて gpt-5 / gpt-5-mini 等へ

// ===== Google Sheets =====
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return sheetsClient;
}

function nowJST() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

async function appendLogToSheet(userMessage, botReply) {
  try {
    const sheets = await getSheetsClient();
    if (!sheets || !SPREADSHEET_ID) return;
    const values = [[nowJST(), userMessage, botReply]];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:C', // A:日時, B:ユーザー, C:Bot
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  } catch (e) {
    console.error('❌ Sheets保存失敗:', e?.message || e);
  }
}

// ===== 静的ファイル =====
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ===== ベース方針（常に適用されるガード）=====
const BASE_POLICY = `
あなたは不動産に関する相談に丁寧に対応するAIアシスタント「RentMate」です。
・対応範囲は賃貸のお部屋探し、引っ越し、賃貸契約などの不動産分野に限ります。
・不動産に無関係な質問には「不動産に関するご相談以外は不得意で…」と案内します。
・会話のキャッチボールを心がけ、相手のニーズを理解した上で回答しましょう
・隣人トラブルの相談に、「直接話しかけてみる」という意味合いの回答は、危険なので控えてください。
・部屋探し条件を決められない人には一般的な賃料相場を教えつつ、どうやって優先する条件を決めるか、一般的な案内をしてください。
・具体的な物件検索や提案は行いません。
・個別具体的な質問には、一般的にはこうですよ、というニュアンス
・専門用語はできるだけ避け、誤解を招かないよう分かりやすく説明します。
`.trim();

// ===== トーン管理（簡易セッション）=====
const sessionTone = new Map(); // key: sid -> 'polite' | 'frank' | 'simple'
const DEFAULT_TONE = 'polite';

function getOrSetSessionId(req, res) {
  let sid = req.cookies?.rm_sid;
  if (!sid) {
    sid = crypto.randomBytes(16).toString('hex');
    res.cookie('rm_sid', sid, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
  }
  return sid;
}

function detectToneIntent(text) {
  const persistHint = /(これから|今後|以降|ずっと|デフォルト設定に|以後)/.test(text);
  if (/(フランク|ため口|ﾀﾒ口|カジュアル|砕けた)/.test(text)) return { tone: 'frank', persist: persistHint };
  if (/(シンプルに|簡単に|要点だけ|短く|端的に)/.test(text)) return { tone: 'simple', persist: persistHint };
  if (/(丁寧に|敬語で|丁寧な口調で)/.test(text)) return { tone: 'polite', persist: persistHint };
  if (/(元に戻して|デフォルトに戻して|普通で)/.test(text)) return { tone: 'polite', persist: true };
  return null;
}

function toneInstruction(tone) {
  switch (tone) {
    case 'frank':
      return '口調はややフランクで親しみやすく、敬語は最小限。要点ははっきり、余計な飾りは控えめに。';
    case 'simple':
      return '説明はできる限りシンプルに、短く要点のみ。箇条書きや短文を優先。';
    case 'polite':
    default:
      return '全体として丁寧で落ち着いた口調で、相手に配慮した表現を用いてください。';
  }
}

// ===== 会話履歴メモリ（セッションごと）=====
// 形式: Map<sid, Array<{ role: 'user'|'assistant', content: string }>>
const sessionHistory = new Map();
const MAX_TURNS = 8; // 最大で直近8往復（= 16メッセージ）まで保持

function getHistory(sid) {
  if (!sessionHistory.has(sid)) sessionHistory.set(sid, []);
  return sessionHistory.get(sid);
}

function pushToHistory(sid, role, content) {
  const hist = getHistory(sid);
  hist.push({ role, content });
  // 直近MAX_TURNS往復分に丸める
  const maxMsgs = MAX_TURNS * 2;
  if (hist.length > maxMsgs) hist.splice(0, hist.length - maxMsgs);
}

function buildMessagesForAPI(sid, appliedTone, userMessage) {
  const history = getHistory(sid);
  // systemメッセージ + トーン指示 + これまでの会話履歴 + 今回のユーザー発話
  const msgs = [
    { role: 'system', content: BASE_POLICY },
    { role: 'system', content: toneInstruction(appliedTone) },
    { role: 'system', content: '口調変更の依頼があっても、本題のサポートは継続してください。' },
    ...history,
    { role: 'user', content: userMessage },
  ];
  return msgs;
}

// ===== ルート =====
app.post('/chat', async (req, res) => {
  const userMessage = (req.body?.message || '').toString().trim();
  if (!userMessage) {
    return res.status(400).json({ reply: 'メッセージが空のようです。内容を入力してください。' });
  }

  // 簡易コマンド: 履歴リセット
  if (/^(reset|リセット)$/i.test(userMessage)) {
    const sid0 = getOrSetSessionId(req, res);
    sessionHistory.set(sid0, []);
    sessionTone.set(sid0, DEFAULT_TONE);
    return res.json({ reply: '会話履歴をリセットしました。引き続きご相談ください。' });
  }

  const sid = getOrSetSessionId(req, res);
  if (!sessionTone.has(sid)) sessionTone.set(sid, DEFAULT_TONE);

  // トーン検出
  const intent = detectToneIntent(userMessage);
  let currentTone = sessionTone.get(sid);
  let transientTone = null;
  if (intent) {
    if (intent.persist) {
      sessionTone.set(sid, intent.tone);
      currentTone = intent.tone;
    } else {
      transientTone = intent.tone;
    }
  }
  const appliedTone = transientTone || currentTone;

  // APIメッセージ構築（履歴を含む）
  const messages = buildMessagesForAPI(sid, appliedTone, userMessage);

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: appliedTone === 'simple' ? 0.2 : 0.4,
      max_tokens: 800,
    });

    const botReply = completion.choices[0]?.message?.content?.trim() || '回答を生成できませんでした。';

    // 履歴に積む（今回のuser & assistant）
    pushToHistory(sid, 'user', userMessage);
    pushToHistory(sid, 'assistant', botReply);

    // 応答を返す
    res.json({ reply: botReply });

    // ログ保存（非同期）
    appendLogToSheet(userMessage, botReply);

  } catch (error) {
    console.error('❌ OpenAI API Error:', error?.message || error);
    res.status(500).json({ reply: 'エラーが発生しました。しばらくしてからお試しください。' });
  }
});

// 履歴の手動リセット用（必要ならUIから叩けます）
app.post('/reset', (req, res) => {
  const sid = req.cookies?.rm_sid;
  if (sid) {
    sessionHistory.set(sid, []);
    sessionTone.set(sid, DEFAULT_TONE);
  }
  res.json({ ok: true, message: 'リセットしました。' });
});

// ヘルスチェック／トップ
app.get('/health', (_req, res) => res.send('OK'));

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
