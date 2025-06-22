const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function translateAnswer(text, targetLang) {
  const modelMap = {
    hi: "Helsinki-NLP/opus-mt-en-hi",
    fr: "Helsinki-NLP/opus-mt-en-fr",
    de: "Helsinki-NLP/opus-mt-en-de",
    es: "Helsinki-NLP/opus-mt-en-es",
  };

  const model = modelMap[targetLang];
  if (!model) return text;

  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: text },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data[0]?.translation_text || text;
  } catch (err) {
    console.error("MarianMT translation error:", err.response?.data || err.message);
    return text;
  }
}

app.post("/api/faq", async (req, res) => {
  const { query } = req.body;

  const { franc } = await import('franc-min');
  const detectedLang = franc(query, {
    only: ['hin', 'eng', 'deu', 'fra', 'spa']
  });

  let targetLang = "en";
if (query.length > 15 && detectedLang !== "eng") {
  const langMap = { hin: "hi", deu: "de", fra: "fr", spa: "es" };
  targetLang = langMap[detectedLang] || "en";
}

  const { data: faqs } = await supabase.from("faqs").select("*");
  const questions = faqs.map(f => f.question);

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    {
      inputs: {
        source_sentence: query,
        sentences: questions,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.HF_API_KEY}`,
        Accept: "application/json",
      },
    }
  );

  const scores = response.data;
  const bestIndex = scores.indexOf(Math.max(...scores));
  const bestMatch = faqs[bestIndex];

  if (scores[bestIndex] < 0.6) {
    let fallback = "Sorry, I do not know the answer to that.";

    if (targetLang !== "en") {
      fallback = await translateAnswer(fallback, targetLang);
    }

    return res.json({
      answer: fallback,
      question: null,
      confidence: null,
      language: targetLang,
    });
  }

  const translatedAnswer = targetLang !== "en"
  ? await translateAnswer(bestMatch.answer, targetLang)
  : bestMatch.answer;

  res.json({
    question: bestMatch.question,
    answer: translatedAnswer,
    confidence: scores[bestIndex],
    language: targetLang,
  });
});

app.listen(3000, () => console.log("Bot is running on http://localhost:3000"));
