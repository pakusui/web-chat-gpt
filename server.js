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
      messages: [{ role: 'user', content: userMessage }],
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
