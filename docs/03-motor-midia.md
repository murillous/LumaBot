# 🎨 Motor de Mídia (Media Engine)

Aqui explicamos a matemática e os comandos por trás da geração de stickers.

## 📐 Especificações do WhatsApp

Para um sticker ser válido, ele deve obedecer regras estritas:

| Propriedade | Valor Obrigatório | Razão |
|-------------|-------------------|-------|
| **Formato** | WebP | Único formato aceito pelo WhatsApp |
| **Dimensão** | 512x512 pixels | Especificação oficial |
| **Tamanho** | < 1MB (ideal < 800KB) | Limite de upload |
| **Duração (Animado)** | < 10s (ideal < 6s) | Performance e tamanho |
| **FPS** | 15-30 | Suavidade vs tamanho |
| **Metadados** | Header Exif específico | Identificação do pack |

## 🛠️ O Comando FFmpeg Explicado

No arquivo `VideoConverter.js`, usamos este comando "assustador". Aqui está o que cada parte faz:

```bash
ffmpeg -i input.mp4 \
  -t 6 \                                      # Corta em 6 segundos
  -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15" \
  -c:v libwebp \                              # Codec de vídeo WebP
  -quality 75 \                               # Qualidade de compressão
  -loop 0 \                                   # Loop infinito
  -an \                                       # Remove áudio (Audio None)
  -fs 800K \                                  # Teto de arquivo 800KB
  output.webp
```

### Entendendo o Filtro (-vf)

```
scale=512:512:force_original_aspect_ratio=increase,crop=512:512
```

Isso realiza um **Center Crop** inteligente:

1. **Scale**: Aumenta a imagem até que o lado menor tenha 512px
2. **Crop**: Corta o excesso do lado maior exatamente no centro
3. **Resultado**: Um quadrado 512x512 perfeito sem distorcer a imagem

#### Exemplo Visual

```
Entrada: 1920x1080 (16:9)

Passo 1 - Scale (increase):
┌─────────────────────────┐
│                         │ 910x512 (mantém aspect ratio)
└─────────────────────────┘

Passo 2 - Crop (512x512):
    ┌─────────┐
    │         │ 512x512 (centro extraído)
    └─────────┘

Resultado: Sticker perfeito sem distorção
```

### Comparação de Métodos

| Método | Resultado | Problemas |
|--------|-----------|-----------|
| **Stretch** | Estica para 512x512 | ❌ Deforma a imagem |
| **Contain** | Cabe tudo com bordas | ❌ Bordas pretas/brancas |
| **Cover (nosso)** | Preenche tudo, corta excesso | ✅ Visual profissional |

## 📊 Processo de Conversão de Imagem

### Pipeline Completo

```javascript
// src/processors/ImageProcessor.js
class ImageProcessor {
    async createSticker(imageBuffer) {
        // 1. Valida entrada
        this.validateImage(imageBuffer);
        
        // 2. Processa com Sharp
        const webpBuffer = await sharp(imageBuffer)
            .resize(512, 512, {
                fit: 'cover',           // Center crop
                position: 'center'
            })
            .webp({
                quality: 80,            // Balanço qualidade/tamanho
                lossless: false,        // Permite compressão
                smartSubsample: true    // Otimiza cores
            })
            .toBuffer();
        
        // 3. Adiciona Exif
        const withExif = await this.addExifMetadata(webpBuffer);
        
        // 4. Valida saída
        this.validateSticker(withExif);
        
        return withExif;
    }
}
```

### Configurações do Sharp (Explicadas)

```javascript
{
    fit: 'cover',
    // Outras opções:
    // 'contain' - Cabe tudo (com bordas)
    // 'fill' - Estica (distorce)
    // 'inside' - Reduz até caber
    // 'outside' - Aumenta até cobrir
    
    position: 'center',
    // Outras opções:
    // 'top', 'bottom', 'left', 'right'
    // 'entropy' - Foco na área com mais detalhes
    // 'attention' - Foco em faces/objetos
    
    background: { r: 255, g: 255, b: 255, alpha: 0 }
    // Cor de fundo se precisar padding
    // alpha: 0 = transparente
}
```

## 🎬 Processo de Conversão de Vídeo

### Pipeline FFmpeg Detalhado

```javascript
// src/processors/VideoConverter.js
class VideoConverter {
    async convertToSticker(videoPath) {
        const outputPath = `${videoPath}.webp`;
        
        const command = [
            '-i', videoPath,
            
            // Duração
            '-t', '6',
            
            // Filtros de vídeo
            '-vf', this.buildVideoFilters(),
            
            // Codec
            '-c:v', 'libwebp',
            
            // Qualidade (0-100, quanto menor = melhor qualidade)
            '-quality', '75',
            
            // Compressão adicional
            '-compression_level', '6',
            
            // Loop infinito
            '-loop', '0',
            
            // Remove áudio
            '-an',
            
            // Limite de tamanho
            '-fs', '800K',
            
            // Sobrescreve sem perguntar
            '-y',
            
            outputPath
        ];
        
        return this.executeFFmpeg(command);
    }
    
    buildVideoFilters() {
        // Filtros encadeados com vírgula
        return [
            'scale=512:512:force_original_aspect_ratio=increase',
            'crop=512:512',
            'fps=15'
        ].join(',');
    }
}
```

### Otimizações de Performance

#### Técnica 1: Two-Pass Encoding (Opcional)

Para vídeos maiores, podemos fazer encoding em duas passadas:

```bash
# Passada 1: Análise
ffmpeg -i input.mp4 -vf "..." -pass 1 -f null /dev/null

# Passada 2: Encoding com dados da passada 1
ffmpeg -i input.mp4 -vf "..." -pass 2 output.webp
```

**Resultado:** +10% de qualidade visual com mesmo tamanho.

#### Técnica 2: Ajuste Dinâmico de FPS

```javascript
async optimizeFPS(videoPath) {
    // Detecta FPS original
    const originalFPS = await this.detectFPS(videoPath);
    
    // Decide FPS ideal
    let targetFPS;
    if (originalFPS >= 30) {
        targetFPS = 20; // Suavidade boa
    } else if (originalFPS >= 24) {
        targetFPS = 15; // Padrão
    } else {
        targetFPS = 10; // Econômico
    }
    
    return targetFPS;
}
```

## 🏷️ Metadados Exif (WebP)

O WhatsApp não lê o autor do sticker no nome do arquivo, mas sim em um chunk binário EXIF dentro do WebP.

### Estrutura do Exif

```javascript
// src/utils/ExifWriter.js
class ExifWriter {
    createExifMetadata() {
        const exif = {
            'sticker-pack-id': 'com.lumabot.stickers',
            'sticker-pack-name': 'LumaBot',
            'sticker-pack-publisher': 'LumaBot v1.0'
        };
        
        // Converte para formato binário
        return this.encodeExif(exif);
    }
    
    encodeExif(data) {
        const json = JSON.stringify(data);
        
        // Estrutura do chunk Exif
        const buffer = Buffer.alloc(json.length + 4);
        buffer.writeUInt32LE(json.length, 0);
        buffer.write(json, 4, 'utf-8');
        
        return buffer;
    }
}
```

### Injetando Exif no WebP

```javascript
async addExifToWebP(webpBuffer) {
    // 1. Lê header WebP
    const header = webpBuffer.slice(0, 12);
    
    // 2. Verifica se é VP8 ou VP8L
    const isVP8 = header.toString('utf-8', 8, 12) === 'VP8 ';
    
    if (!isVP8) {
        throw new Error('Formato WebP não suportado para Exif');
    }
    
    // 3. Converte para VP8X (Extended)
    const vp8xHeader = Buffer.from('VP8X', 'utf-8');
    
    // 4. Cria chunk EXIF
    const exifChunk = this.createExifChunk();
    
    // 5. Reconstrói arquivo
    return Buffer.concat([
        header.slice(0, 8),
        vp8xHeader,
        exifChunk,
        webpBuffer.slice(12)
    ]);
}
```

### Biblioteca wa-sticker-formatter

Para simplificar, usamos uma biblioteca pronta:

```javascript
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

async function createSticker(imageBuffer) {
    const sticker = new Sticker(imageBuffer, {
        pack: 'LumaBot',
        author: 'LumaBot v1.0',
        type: StickerTypes.DEFAULT, // ou CROPPED, CIRCLE
        quality: 80
    });
    
    return await sticker.toBuffer();
}
```

## 🎭 Tipos de Stickers

### 1. Sticker Normal (Padrão)

```javascript
type: StickerTypes.DEFAULT
```

- Fundo transparente ou colorido
- Forma livre

### 2. Sticker Recortado (Cropped)

```javascript
type: StickerTypes.CROPPED
```

- Remove fundo automaticamente
- Útil para fotos de pessoas/objetos

### 3. Sticker Circular (Circle)

```javascript
type: StickerTypes.CIRCLE
```

- Aplica máscara circular
- Bom para avatares

## 🔍 Detecção Automática de Tipo de Mídia

```javascript
class MediaProcessor {
    detectMediaType(buffer) {
        // Lê primeiros bytes (magic numbers)
        const header = buffer.slice(0, 12);
        
        // JPEG: FF D8 FF
        if (header[0] === 0xFF && header[1] === 0xD8) {
            return 'image/jpeg';
        }
        
        // PNG: 89 50 4E 47
        if (header.toString('hex', 0, 4) === '89504e47') {
            return 'image/png';
        }
        
        // WebP: 52 49 46 46 ... 57 45 42 50
        if (header.toString('utf-8', 0, 4) === 'RIFF' &&
            header.toString('utf-8', 8, 12) === 'WEBP') {
            return 'image/webp';
        }
        
        // MP4: ... 66 74 79 70
        if (header.toString('utf-8', 4, 8).includes('ftyp')) {
            return 'video/mp4';
        }
        
        return 'unknown';
    }
}
```

## 📏 Cálculo de Tamanho Ideal

### Fórmula de Compressão

```javascript
function calculateOptimalQuality(fileSize) {
    // Tamanho alvo: 800KB
    const target = 800 * 1024;
    
    if (fileSize <= target) {
        return 100; // Sem compressão
    }
    
    // Regra de três
    const ratio = target / fileSize;
    const quality = Math.floor(100 * ratio);
    
    // Limites
    return Math.max(50, Math.min(quality, 100));
}
```

### Compressão Iterativa

Se o sticker ficou muito grande, reprocessamos:

```javascript
async ensureSize(stickerBuffer, maxSize = 800 * 1024) {
    let quality = 80;
    let result = stickerBuffer;
    
    while (result.byteLength > maxSize && quality > 30) {
        console.log(`Tamanho: ${result.byteLength}. Tentando quality=${quality}...`);
        
        result = await sharp(stickerBuffer)
            .webp({ quality })
            .toBuffer();
        
        quality -= 10;
    }
    
    if (result.byteLength > maxSize) {
        throw new Error('Impossível comprimir abaixo de 800KB');
    }
    
    return result;
}
```

## 🚀 Performance Benchmarks

### Tempos de Processamento (Médios)

| Operação | Tempo | Gargalo |
|----------|-------|---------|
| Imagem → Sticker (Sharp) | 0.2s | CPU |
| Vídeo → Sticker (FFmpeg) | 3-5s | CPU + I/O |
| Adicionar Exif | 0.01s | RAM |
| Upload WhatsApp | 0.5-2s | Rede |

### Otimizações Aplicadas

1. **Processamento Assíncrono**: Não bloqueia outras mensagens
2. **Cache de Temporários**: Reutiliza pastas `/tmp`
3. **Limpeza Automática**: Remove arquivos após 5 minutos
4. **Limite de Concorrência**: Máx 3 conversões simultâneas

```javascript
class MediaProcessor {
    constructor() {
        this.queue = [];
        this.processing = 0;
        this.maxConcurrent = 3;
    }
    
    async process(buffer) {
        if (this.processing >= this.maxConcurrent) {
            await this.waitForSlot();
        }
        
        this.processing++;
        try {
            return await this.convert(buffer);
        } finally {
            this.processing--;
            this.processQueue();
        }
    }
}
```

## 🧪 Testes de Qualidade

```javascript
// test/media-test.js
async function testStickerQuality() {
    const testImages = [
        'test/assets/photo.jpg',
        'test/assets/meme.png',
        'test/assets/screenshot.webp'
    ];
    
    for (const imagePath of testImages) {
        const buffer = fs.readFileSync(imagePath);
        const sticker = await ImageProcessor.createSticker(buffer);
        
        console.log(`\n=== ${path.basename(imagePath)} ===`);
        console.log(`Tamanho original: ${buffer.byteLength} bytes`);
        console.log(`Tamanho sticker: ${sticker.byteLength} bytes`);
        console.log(`Compressão: ${((1 - sticker.byteLength/buffer.byteLength) * 100).toFixed(1)}%`);
        
        // Salva para inspeção visual
        fs.writeFileSync(`test/output/${path.basename(imagePath)}.webp`, sticker);
    }
}
```

## 📥 Download de Mídia de Redes Sociais

O LumaBot usa o **yt-dlp** para baixar vídeos e imagens do Twitter/X e Instagram diretamente no chat.

### Fluxo Completo

```
!download <url>
    ↓
VideoDownloader.download(url)     → yt-dlp salva o arquivo em temp/ (MP4 ou imagem)
    ↓
Extensão é imagem (.jpg/.jpeg/.png/.webp)?
    ├─ sim → sock.sendMessage({ image: buffer })        → Enviado ao WhatsApp
    └─ não → VideoConverter.remuxForMobile()            → FFmpeg converte para H.264 + faststart
           → sock.sendMessage({ video: buffer })        → Enviado ao WhatsApp
    ↓
Arquivos temporários removidos
```

### Por que imagens pulam o remux?

O seletor de formato (`VIDEO_DOWNLOAD_FORMAT`) termina no fallback `best`, que para posts de
foto (Instagram `/p/`, imagem no X) é a própria imagem — então o yt-dlp já baixa o arquivo
correto. Passar um `.jpg` pelo FFmpeg geraria um MP4 de 1 frame, que o WhatsApp rejeita ou
exibe quebrado. O `DownloadPlugin` detecta a extensão do arquivo produzido e envia direto
como `{ image }`, registrando a métrica `images_downloaded`.

### Por que Re-encodar?

Vídeos baixados de redes sociais frequentemente usam codecs como **VP9**, **H.265** ou **AV1**, que não são reproduzidos corretamente no iOS via WhatsApp. O re-encoding garante:

| Problema | Solução |
|----------|---------|
| Codec incompatível (VP9/H.265/AV1) | `-c:v libx264` (H.264 universal) |
| Vídeo não carrega no iOS | `-movflags faststart` (moov atom no início) |
| Pixel format incompatível | `-pix_fmt yuv420p` |

### O Comando FFmpeg (remuxForMobile)

```bash
ffmpeg -y -i input.mp4 \
  -c:v libx264 \          # Re-encoda vídeo para H.264
  -preset ultrafast \     # Velocidade máxima de encoding
  -crf 23 \               # Qualidade (0=melhor, 51=pior) — 23 é o padrão
  -pix_fmt yuv420p \      # Pixel format universal
  -c:a copy \             # Copia áudio sem re-encoding (muito mais rápido)
  -movflags faststart \   # Coloca metadados no início (obrigatório iOS)
  output.mp4
```

**Por que `ultrafast` e não `fast`?**
O preset `ultrafast` é ~4x mais rápido que `fast` com uma leve diferença de compressão (arquivo ligeiramente maior). Para vídeos de redes sociais já comprimidos, essa troca é ideal.

**Por que `-c:a copy`?**
O áudio baixado pelo yt-dlp já é AAC (padrão do mp4), compatível com iOS. Re-encodar seria desperdício de tempo sem ganho.

### Limite de Resolução (720p)

O formato configurado em `constants.js` limita o download a 720p:

```javascript
VIDEO_DOWNLOAD_FORMAT: "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best"
```

**Motivo**: O WhatsApp só envia em HD se o usuário ativar a opção manualmente. Baixar em 1080p/4K seria desperdício de banda, armazenamento e tempo de encoding sem benefício visível.

### Download Automático do yt-dlp

O binário `yt-dlp.exe` é baixado automaticamente na primeira execução, sem necessidade de instalação manual:

```javascript
// src/services/VideoDownloader.js
static async getBinaryPath() {
    if (!fs.existsSync(YTDLP_BIN)) {
        // Baixa de github.com/yt-dlp/yt-dlp/releases/latest
        await this._downloadBinary();
    }
    return YTDLP_BIN;
}
```

---

**Próximo passo**: Entenda o sistema de banco de dados em [04-banco-dados.md](./04-banco-dados.md)