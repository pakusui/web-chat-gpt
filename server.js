require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// ===== OpenAI 設定 =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ===== Google Sheets 設定 =====
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
if (!SPREADSHEET_ID) {
  console.warn('[WARN] SPREADSHEET_ID が未設定です。ログ保存は失敗します。');
}

let sheetsClient = null;
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('[WARN] GOOGLE_SERVICE_ACCOUNT_JSON が未設定です。ログ保存は失敗します。');
    return null;
  }

  // RenderではJSONファイルを置かず、環境変数から直接読み込む
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return sheetsClient;
}

// JSTのタイムスタンプ（見やすさ重視）
function nowJST() {
  return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

// スプレッドシートへ1行追記
async function appendLogToSheet(userMessage, botReply) {
  try {
    const sheets = await getSheetsClient();
    if (!sheets || !SPREADSHEET_ID) return;

    const values = [[nowJST(), userMessage, botReply]];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:C',                 // A:日時, B:ユーザー, C:Bot
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  } catch (err) {
    console.error('❌ Sheets への保存に失敗:', err?.message || err);
  }
}

// ===== ミドルウェア =====
app.use(bodyParser.json());

// public配下に index.html / style.css / script.js を置く想定
app.use(express.static(path.join(__dirname, 'public')));

// ===== プロンプト（要件どおり丁寧＆範囲限定） =====
const SYSTEM_PROMPT = `
あなたは不動産に関する相談に丁寧に対応する、フレンドリーなAIアシスタント「RentMate」です。
・対応範囲は「お部屋探し」「引っ越し」「賃貸契約」など、不動産に関する内容に限られます。
・不動産に無関係な質問には、「不動産に関するご相談に限定させていただいております」と案内してください。
・物件の検索や提案は不得手なので、お客様が具体的な希望条件をお持ちの場合は、営業担当に直接ご連絡いただくようご案内してください。
・担当に直接連絡を勧める際、「お客さまの状況に応じたご提案が可能な為」という意味合いの一言を添えてください。
・直接連絡を勧めすぎるのは、マイナスイメージを持たれるので、2回に1回程度にし、伝え方を都度工夫してください。
・隣人トラブルの相談に、「直接話しかけてみる」という意味合いの回答は、危険なので控えてください。
・部屋探し条件を決められない人には一般的な賃料相場を教えつつ、どうやって優先する条件を決めるか、一般的な案内をしてください。
・個別具体的な質問には、一般的な回答・提案をした上で、「詳細については営業担当にお尋ねいただくのが確実です」と丁寧に案内してください。
・専門用語はできるだけ避け、簡潔で分かりやすい説明を心がけてください。
`.trim();

// ===== ルーター =====
app.post('/chat', async (req, res) => {
  const userMessage = (req.body?.message || '').toString().trim();
  if (!userMessage) {
    return res.status(400).json({ reply: 'メッセージが空のようです。内容を入力してください。' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.4,
      max_tokens: 800,
    });

    const botReply = completion.choices[0]?.message?.content?.trim() || '回答を生成できませんでした。';

    // 返信を先に返す（ユーザー体験優先）
    res.json({ reply: botReply });

    // 返信後に非同期でログ保存（失敗してもユーザーには影響しない）
    appendLogToSheet(userMessage, botReply);

  } catch (error) {
    console.error('❌ OpenAI API Error:', error?.message || error);
    res.status(500).json({ reply: 'エラーが発生しました。しばらくしてからお試しください。' });
  }
});

// ヘルスチェック／トップ
app.get('/health', (_req, res) => res.send('OK'));

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
