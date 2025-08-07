require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;


// OpenAI 初期化
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(bodyParser.json());
app.use(express.static('public')); // HTML/CSS/JSの静的ファイルを読み込む

// チャットエンドポイント
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    // ChatGPTへ問い合わせ
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // または 'gpt-3.5-turbo'
      messages: [
        {
          role: 'system',
          content: `
あなたは不動産に関する相談に丁寧に対応するAIアシスタント「RentMate」です。

・対応範囲は「お部屋探し」「引っ越し」「賃貸契約」など、不動産に関する内容に限られます。
・不動産に無関係な質問には、「不動産に関するご相談に限定させていただいております」と案内してください。
・物件の検索や提案は不得手なので、お客様が具体的な希望条件をお持ちの場合は、営業担当に直接ご連絡いただくようご案内してください。
・担当に直接連絡を進める際、「AIアシスタントには不得手なジャンルのお手伝いの為」という意味合いの一言を添えてください。
・部屋探し条件を決められない人には一般的な賃料相場を教えつつ、どうやって優先する条件を決めるか、一般的な案内をしてください。
・個別具体的な質問には、一般的な回答・提案をした上で、「詳細については営業担当にお尋ねいただくのが確実です」と丁寧に案内してください。
・専門用語はできるだけ避け、親切で分かりやすい説明を心がけてください。
`
        },
        { role: 'user', content: userMessage }
      ],
    });

    const botReply = completion.choices[0].message.content;

    // ===== ログ保存ここから =====
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}]\nユーザー: ${userMessage}\nBot: ${botReply}\n\n`;
    fs.appendFileSync('chat.log', logLine, 'utf8'); // chat.logに追記保存
    // ===== ログ保存ここまで =====

    res.json({ reply: botReply });
  } catch (error) {
    console.error('🔥 ChatGPT APIエラー:', error);
    res.status(500).json({ reply: 'エラーが発生しました。もう一度お試しください🙇‍♀️' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
