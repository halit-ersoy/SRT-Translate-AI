import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import "./style.css";

let API_KEY = "AIzaSyAJY1EQSvq0kltCVx4LYBvQ-c-KfhXiw5U";

// DOM elemanlarının tanımlanması
const uploadBtn = document.getElementById("uploadBtn");
const srtFileInput = document.getElementById("srtFile");
const status = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");
const extractedDownloadLink = document.getElementById("extractedDownloadLink");
const translationPreview = document.getElementById("translationPreview");
const promptDisplay = document.getElementById("promptDisplay");

// Kullanıcıdan alınacak ayar inputları
const batchSizeInput = document.getElementById("batchSize");
const sleepTimeInput = document.getElementById("sleepTime");
const maxRetriesInput = document.getElementById("maxRetries");
const targetLanguageSelect = document.getElementById("targetLanguage");
const modelTypeSelect = document.getElementById("modelType");

uploadBtn.onclick = async () => {
  // Dosya seçilmemişse uyarı ver
  if (!srtFileInput.files.length) {
    alert("Lütfen bir SRT dosyası seçiniz.");
    return;
  }

  // Ayar değerlerini al
  const BATCH_SIZE = parseInt(batchSizeInput.value, 10) || 3;
  const SLEEP_TIME = parseInt(sleepTimeInput.value, 10) || 4;
  const MAX_RETRIES = parseInt(maxRetriesInput.value, 10) || 3;
  const targetLanguage = targetLanguageSelect.value || "Turkish";

  // Model seçimine göre Gemini modeli ayarlanır
  const modelType = modelTypeSelect.value; // "flash" veya "pro"
  let modelName = "gemini-1.5-flash"; // varsayılan
  if (modelType === "pro") {
    modelName = "gemini-1.5-pro";
  }

  status.textContent = "Dosya okunuyor...";
  translationPreview.textContent = "";
  promptDisplay.textContent = "";

  try {
    // SRT dosyasının içeriğini oku ve parçalara ayır
    const fileContent = await srtFileInput.files[0].text();
    const srtSections = parseSRT(fileContent);

    // Her bölümdeki diyalogları birleştirip numaralandırma (örnek olarak)
    const rawDialogues = srtSections.map((section, index) => `${index + 1}: ${section.text.join(" ")}`);

    // Ayıklanan diyalogları indirilebilir hale getirin (isteğe bağlı)
    const extractedContent = rawDialogues.join("\n");
    extractedDownloadLink.href = URL.createObjectURL(new Blob([extractedContent], { type: "text/plain" }));
    extractedDownloadLink.download = "extracted_dialogues.txt";
    extractedDownloadLink.style.display = "block";
    extractedDownloadLink.textContent = "Ayıklanmış Diyalogları İndir";

    status.textContent = "Diyaloglar ayrıştırıldı. Çeviri başlatılıyor...";

    // Diyalogları belirlenen batch büyüklüğünde ayırma
    const batches = [];
    let currentBatch = [];
    rawDialogues.forEach(dialogue => {
      currentBatch.push(dialogue);
      if (currentBatch.length === BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    });
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    let translatedDialogues = [];

    // Gemini API için kütüphaneyi başlatın
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    });

    // Her batch için sırasıyla çeviri işlemini yapma
    for (let i = 0; i < batches.length; i++) {
      let success = false;
      let attempts = 0;
      let translatedLines = [];
      const globalStartIndex = i * BATCH_SIZE;
      const currentBatchSize = batches[i].length;

      // Önceki bağlamın oluşturulması
      let prevContext = "";
      if (globalStartIndex > 0) {
        const contextStart = Math.max(0, globalStartIndex - BATCH_SIZE);
        const prevContextLines = rawDialogues.slice(contextStart, globalStartIndex);
        prevContext = "Previous context:\n" + prevContextLines.join("\n") + "\n\n";
      }

      // Çevrilecek metin (batch)
      const subtitlesText = "Subtitles to translate:\n" + batches[i].join("\n") + "\n\n";

      // Sonraki bağlamın oluşturulması
      let nextContext = "";
      const nextContextLines = rawDialogues.slice(globalStartIndex + currentBatchSize, globalStartIndex + currentBatchSize + BATCH_SIZE);
      if (nextContextLines.length > 0) {
        nextContext = "Following context:\n" + nextContextLines.join("\n") + "\n\n";
      }

      while (!success && attempts < MAX_RETRIES) {
        attempts++;
        status.textContent = `Çeviri işleniyor... (${i + 1}/${batches.length}) - Deneme ${attempts}`;

        // Prompt oluşturma: seçilen dile göre
        const promptText = buildPromptText(prevContext, subtitlesText, nextContext, currentBatchSize, targetLanguage);
        promptDisplay.textContent += `\n----- Batch ${i + 1} (Deneme ${attempts}) Prompt -----\n${promptText}\n\n`;

        const contents = [
          {
            role: "user",
            parts: [{ text: promptText }]
          }
        ];

        let batchTranslation = "";
        try {
          // Gemini API'yı çağır ve akıştan dönen sonuçları topla
          const result = await model.generateContentStream({ contents });
          for await (let response of result.stream) {
            batchTranslation += response.text();
            translationPreview.textContent += response.text();
          }
        } catch (err) {
          console.error("Stream hatası:", err);
        }

        // Çıktıyı satırlara böl ve boş satırları temizle
        translatedLines = batchTranslation.split("\n").filter(line => line.trim() !== "");
        if (translatedLines.length === currentBatchSize) {
          success = true;
          translationPreview.textContent += `\nBatch ${i + 1} başarılı. (${translatedLines.length} satır)\n\n`;
        } else {
          translationPreview.textContent += `\nBatch ${i + 1} Deneme ${attempts} başarısız: beklenen ${currentBatchSize} satır, alınan ${translatedLines.length} satır.\n\n`;
          console.warn(`Batch ${i + 1}: Beklenen ${currentBatchSize} satır alınamadı. Tekrar deneniyor...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (!success) {
        throw new Error(`Batch ${i + 1} için çeviri doğrulaması ${MAX_RETRIES} denemede başarısız oldu.`);
      }

      translatedDialogues = translatedDialogues.concat(translatedLines);
      // Batch'ler arası bekleme
      await new Promise(resolve => setTimeout(resolve, SLEEP_TIME * 1000));
    }

    // Çeviri sonuçlarını SRT bölümlerine yerleştirme
    for (let i = 0; i < srtSections.length; i++) {
      if (translatedDialogues[i]) {
        const cleanText = extractTurkish(translatedDialogues[i]).trim();
        srtSections[i].text = [convertBracketContentToUpperCase(cleanText)];
      }
    }

    // Güncellenmiş SRT dosyasını oluştur ve indirme linkini ayarla
    const newSrtContent = srtSections
      .map(section => `${section.index}\n${section.timestamp}\n${section.text.join("\n")}`)
      .join("\n\n");

    const blob = new Blob([newSrtContent], { type: "text/plain" });
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = "translated.srt";
    downloadLink.style.display = "block";
    downloadLink.textContent = "Çevrilen SRT Dosyasını İndir";
    status.textContent = "Çeviri tamamlandı!";
  } catch (error) {
    console.error(error);
    status.textContent = "Hata: " + error;
  }
};

// SRT dosyasını bölümlere ayıran fonksiyon
function parseSRT(data) {
  const lines = data.split(/\r?\n/);
  const sections = [];
  let currentSection = { index: "", timestamp: "", text: [] };

  for (let line of lines) {
    if (line.trim() === "") {
      if (currentSection.index) {
        sections.push({ ...currentSection });
      }
      currentSection = { index: "", timestamp: "", text: [] };
    } else if (!currentSection.index) {
      currentSection.index = line.trim();
    } else if (!currentSection.timestamp) {
      currentSection.timestamp = line.trim();
    } else {
      currentSection.text.push(line);
    }
  }
  if (currentSection.index) {
    sections.push(currentSection);
  }
  return sections;
}

// Prompt oluşturma fonksiyonu
function buildPromptText(prevContext, subtitlesText, nextContext, currentBatchSize, targetLanguage) {
  let numberingExample = "";
  for (let i = 1; i <= currentBatchSize; i++) {
    numberingExample += `${i}: <translation of line ${i}>\n`;
  }
  return (
    "You are provided with numbered movie subtitle dialogues that need to be translated to " +
    targetLanguage +
    ". " +
    "Each numbered dialogue is a single line, even if the original has multiple sentences. " +
    "Translate the dialogues in a natural, human-like style using informal language. " +
    "Avoid overly formal translations. " +
    "For each input line, produce a corresponding translated line, and ensure that the translation " +
    "for each numbered dialogue appears with the same number as the input. " +
    "Your output must be exactly " + currentBatchSize + " lines, numbered as follows:\n" +
    numberingExample +
    "Do not include any additional text or commentary. " +
    "Translate only the subtitles provided.\n\n" +
    (prevContext ? prevContext : "") +
    subtitlesText +
    (nextContext ? nextContext : "")
  );
}

// Metnin başında bulunan sayı ve ":" ifadesini kaldıran yardımcı fonksiyon
function extractTurkish(text) {
  const regex = /^\d+\s*:\s*(.*)/;
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

// Kare parantez içindeki metni büyük harfe dönüştüren yardımcı fonksiyon
function convertBracketContentToUpperCase(text) {
  return text.replace(/\[([^\]]+)\]/g, (match, p1) => p1.toUpperCase());
}
