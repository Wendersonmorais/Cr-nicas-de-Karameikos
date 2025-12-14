import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from "react-markdown";

// --- Types ---
interface Option {
  label: string;
  sub?: string;
  value: string;
}

interface FormField {
  id: string;
  type: "text" | "select" | "radio" | "checkbox";
  label: string;
  placeholder?: string;
  options?: string[];
  max_select?: number; // For checkboxes
}

interface FormSchema {
  titulo: string;
  fields: FormField[];
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  isStreaming?: boolean;
  imageUrl?: string;
  isGeneratingImage?: boolean;
  options?: Option[];
  form?: FormSchema; // New type for forms
  isSavePoint?: boolean;
}

interface GameStatus {
  location: string;
  hp: string;
  quest: string;
}

interface RollEntry {
  id: string;
  die: string;
  result: number;
  timestamp: string;
}

// --- Constants & Config ---
const MODEL_NAME = "gemini-2.5-flash";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";

const SOUND_LIBRARY: Record<string, string> = {
  MUSICA: "https://actions.google.com/sounds/v1/horror/horror_ambience.ogg",
  VENTO: "https://actions.google.com/sounds/v1/weather/heavy_wind.ogg",
  CHUVA: "https://actions.google.com/sounds/v1/weather/rain_heavy_loud.ogg",
  TROVAO: "https://actions.google.com/sounds/v1/weather/thunder_heavy_rain.ogg",
  FLORESTA: "https://actions.google.com/sounds/v1/ambiences/forest_atmosphere.ogg",
  NOITE: "https://actions.google.com/sounds/v1/ambiences/outdoor_camping.ogg",
  MASMORRA: "https://actions.google.com/sounds/v1/ambiences/cave_atmosphere.ogg",
  TAVERNA: "https://actions.google.com/sounds/v1/crowds/battle_crowd_celebrate.ogg", 
  FOGO: "https://actions.google.com/sounds/v1/ambiences/fire_crackling.ogg",
  COMBATE: "https://actions.google.com/sounds/v1/foley/metal_rattle.ogg", 
  MAR: "https://actions.google.com/sounds/v1/water/waves_crashing.ogg",
  SILENCIO: "",
};

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é o Mestre dos Calabouços (DM) experiente, imparcial e descritivo, narrando uma campanha de D&D 5ª Edição no cenário do Grão-Ducado de Karameikos (Mystara).

**FONTES DE CONHECIMENTO:**
1. Use o cenário de "Karameikos" (Mystara) para geografia, política (conflito Thyatianos vs. Traladaranos), NPCs importantes (Duque Stefan, Barão Ludwig) e monstros locais.
2. Use os livros de "D&D 5e" (Livro do Jogador, Mestre, Monstros) APENAS para as mecânicas de regras, testes, classes e combate.

**REGRAS DE OPERAÇÃO:**
1. **Nunca decida ações pelo jogador.** Pare a narrativa e pergunte: "O que você faz?".
2. **Criação de Personagem:** Ao perguntar sobre raça, classe ou antecedentes, use o PROTOCOLO DE FORMULÁRIO para coletar todos os dados de uma vez.
3. **Testes de Habilidade:** Quando o jogador tentar algo incerto, peça um teste (ex: "Faça um teste de Destreza (Furtividade) CD 15").
4. **Rolagem de Dados:**
   - Se o jogador fornecer o resultado (ex: "[Rolou d20: 15]"), aceite e narre a consequência.
   - Se precisar rolar pelo mundo/NPCs, USE O CÓDIGO PYTHON.
5. **Gerenciamento de Estado:** Ao final de cada resposta importante, exiba o bloco de "Status".
6. **Tom:** Sombrio, misterioso, alta fantasia clássica. Enfatize as tensões étnicas de Karameikos.

**PROTOCOLO DE ROLAGEM DE DADOS (VISUAL):**
1.  **Transparência Total:** NUNCA esconda a matemática. O jogador precisa ver qual dado foi rolado.
2.  **Formato Obrigatório:** Use colchetes para isolar a rolagem do texto narrativo.
    - Padrão: \`[🎲 d{faces}({valor_dado}) + {modificadores} = {TOTAL}]\`
    
3.  **Exemplos de Saída:**
    - Ataque: *Você gira seu machado...* \`[🎲 d20(14) + 4 (força) = 18]\`
    - Dano: *A lâmina corta fundo!* \`[🩸 d8(6) + 2 = 8 de dano]\`
    - Teste de Perícia: *Você tenta se equilibrar...* \`[🦶 d20(3) + 2 (acrobacia) = 5] -> FALHA\`

4.  **Não gere imagens para dados.** Use apenas esse formato de texto e emojis para que o sistema leia corretamente.

**PROTOCOLO DE FORMULÁRIOS (CRIAÇÃO DE FICHA):**
1.  **Gatilho:** Quando for necessário coletar múltiplos dados estruturados do jogador de uma vez (ex: Criação de Personagem, Configuração de Inventário), NÃO peça um por um no chat. Gere um formulário.
2.  **Formato:** Ao final da narrativa, adicione um bloco JSON dentro da tag \`--- [FORMULARIO] ---\`.
3.  **Estrutura do JSON:** Uma lista de objetos \`fields\`. Cada campo deve ter:
    - \`id\`: identificador único.
    - \`type\`: "text" (para digitar), "select" (dropdown), "radio" (escolha única A/B), "checkbox" (múltipla escolha).
    - \`label\`: A pergunta a ser feita.
    - \`options\`: (Apenas para select/radio/checkbox) A lista de opções.
    - \`max_select\`: (Apenas para checkbox) Número máximo de escolhas permitidas.

**MODELO DE RESPOSTA COM FORMULÁRIO:**
[Narrativa introdutória...]
--- [FORMULARIO] ---
{
  "titulo": "Criação de Guerreiro Nível 1",
  "fields": [
    {"id": "nome", "type": "text", "label": "Qual o nome do seu herói?"},
    {"id": "classe_arma", "type": "radio", "label": "Escolha seu equipamento:", "options": ["Espada", "Machado"]}
  ]
}

**SISTEMA DE SAVE/LOAD (CHECKPOINT):**
1. **SALVAR:** Se o usuário solicitar um "Save" ou "Checkpoint", você DEVE gerar um resumo codificado dentro de blocos triplos de crase.
   - O formato DEVE ser:
   \`\`\`
   [CHECKPOINT_KARAMEIKOS]
   PERSONAGEM: [Nome, Raça, Classe, Nível, XP]
   STATUS: [PV Atual/Max, Condições]
   LOCAL: [Localização exata]
   INVENTARIO: [Itens principais, Ouro]
   MISSAO: [Objetivo atual e progresso]
   RELACIONAMENTOS: [NPCs aliados/inimigos e reputação]
   RESUMO_NARRATIVO: [Resumo denso dos últimos eventos para a IA retomar depois]
   \`\`\`
2. **CARREGAR:** Se a mensagem do usuário começar com \`[CHECKPOINT_KARAMEIKOS]\`, você deve:
   - Ler os dados atentamente.
   - Atualizar seu contexto interno.
   - Narrar: "Você recobra a consciência em [Local]..." e continuar a história exatamente de onde parou.

**SISTEMA DE IMERSÃO VISUAL (DIRETOR DE ARTE):**
**GATILHOS:** Nova localização, Combate, NPC Importante.
**FORMATO:**
--- [CENA VISUAL SUGERIDA] ---
**Prompt para Gerador:** [Descrição detalhada em Inglês. Style: Dark fantasy oil painting, gritty, D&D 5e style.]

**SISTEMA DE ÁUDIO (SONOPLASTIA):**
**OBJETIVO:** Definir o som de fundo (loop) para a cena atual. Use 'MUSICA' para momentos de tensão, exploração ou mistério geral. Use sons específicos (VENTO, CHUVA) apenas se o clima for o foco.
**GATILHOS:** Mudança de ambiente ou início de combate.
**LISTA DE SONS DISPONÍVEIS:** MUSICA, VENTO, CHUVA, TROVAO, FLORESTA, NOITE, MASMORRA, TAVERNA, FOGO, COMBATE, MAR, SILENCIO.
**FORMATO:**
--- [AMBIENTE SONORO] ---
**Som:** [KEYWORD]

**PROTOCOLO DE INTERFACE (BOTÕES INTERATIVOS):**
1. **Gatilho:** Sempre que você terminar uma narração que exija uma decisão clara do jogador (ex: Escolher Classe, Escolher Caminho A ou B, Atacar ou Negociar), você DEVE gerar um bloco de opções estruturado.
2. **Formato Obrigatório:** O bloco deve estar SEMPRE no final da resposta, separado por uma quebra de linha, contendo um JSON válido dentro da tag \`--- [OPCOES] ---\`.
3. **Estrutura do JSON:** Uma lista de objetos, onde \`label\` é o texto curto do botão, \`value\` é a ação completa que será enviada como resposta do usuário, e \`sub\` (opcional) para detalhes.

**MODELO DE RESPOSTA:**
[Sua narração descritiva aqui...]

--- [OPCOES] ---
[
  {
    "label": "Humano (Thyatiano)",
    "value": "Eu escolho ser um Humano de descendência Thyatiana. Quais são meus bônus?"
  },
  {
    "label": "Humano (Traladarano)",
    "sub": "Nativo Oprimido",
    "value": "Eu escolho ser um Humano nativo Traladarano. Fale sobre minha cultura."
  }
]

---
**STATUS DO GRUPO:**
* **Local:** [Local]
* **PV:** [Atual]/[Max]
* **Missão Atual:** [Resumo]
---
`;

const INITIAL_GREETING = "Bem-vindo a Karameikos. A névoa cobre as montanhas escarpadas ao norte, enquanto as tensões entre os nativos Traladaranos e os conquistadores Thyatianos fervem nas cidades. Você se encontra na estrada perto de Threshold. O vento uiva, carregando o cheiro de chuva e... algo mais metálico.\n\nAntes de começarmos, quem é você? Escolha um destes arquétipos ou crie o seu:";

const CHARACTER_OPTIONS: Option[] = [
  { label: "Legionário Thyatiano", sub: "Guerreiro Humano", value: "Eu sou um Legionário Thyatiano (Guerreiro Humano). Quero criar minha ficha de Guerreiro agora." },
  { label: "\"Raposa\" Traladarana", sub: "Ladino Humano", value: "Eu sou uma 'Raposa' Traladarana (Ladino Humano). Quero criar minha ficha de Ladino agora." },
  { label: "Erudito de Glantri", sub: "Mago Elfo", value: "Eu sou um Erudito de Glantri (Mago Elfo). Quero criar minha ficha de Mago agora." },
  { label: "Guardião da Floresta", sub: "Patrulheiro Meio-Elfo", value: "Eu sou um Guardião da Floresta (Patrulheiro Meio-Elfo). Quero criar minha ficha de Patrulheiro agora." },
  { label: "✨ Criar meu próprio", sub: "Personalizado", value: "Gostaria de criar meu próprio personagem. Pode me apresentar um FORMULÁRIO para eu preencher os detalhes?" },
];

// --- Audio Helpers ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Components ---

const BackgroundMusic = ({ currentSound, isMuted, volume }: { currentSound: string | null, isMuted: boolean, volume: number }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.loop = true;
    }
    const audio = audioRef.current;
    if (isMuted) {
        audio.volume = 0;
    } else {
        audio.volume = volume;
    }
  }, [isMuted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const playAudio = async () => {
        if (!currentSound || currentSound === "SILENCIO" || !SOUND_LIBRARY[currentSound]) {
            audio.pause();
            return;
        }
        const src = SOUND_LIBRARY[currentSound];
        if (audio.src !== src) {
            audio.src = src;
            try {
                await audio.play();
            } catch(e) { console.log("Autoplay prevented", e); }
        } else {
             if (audio.paused) audio.play().catch(e => console.log(e));
        }
    };
    playAudio();
  }, [currentSound]);

  return null;
};

const VolumeSettingsPopup = ({ 
    isOpen, 
    musicVolume, 
    setMusicVolume, 
    narrationVolume, 
    setNarrationVolume 
}: { 
    isOpen: boolean, 
    musicVolume: number, 
    setMusicVolume: (v: number) => void,
    narrationVolume: number,
    setNarrationVolume: (v: number) => void
}) => {
    if (!isOpen) return null;

    return (
        <div className="absolute top-full right-0 mt-3 bg-[#1e1c19] border border-[#3e352f] p-4 rounded-lg shadow-2xl w-64 z-50 flex flex-col gap-4 animate-fade-in backdrop-blur-md bg-opacity-95">
           <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-[10px] text-stone-400 uppercase font-bold tracking-wider">
                 <div className="flex items-center gap-1"><span className="text-base">🎵</span> Música</div>
                 <span className="text-stone-500">{Math.round(musicVolume * 100)}%</span>
              </div>
              <input 
                type="range" min="0" max="1" step="0.05" 
                value={musicVolume} 
                onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                className="w-full accent-yellow-600 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer hover:bg-stone-600 transition-colors"
              />
           </div>
           
           <div className="h-px bg-stone-800 w-full"></div>

           <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-[10px] text-stone-400 uppercase font-bold tracking-wider">
                 <div className="flex items-center gap-1"><span className="text-base">🗣️</span> Narração</div>
                 <span className="text-stone-500">{Math.round(narrationVolume * 100)}%</span>
              </div>
              <input 
                type="range" min="0" max="1" step="0.05" 
                value={narrationVolume} 
                onChange={(e) => setNarrationVolume(parseFloat(e.target.value))}
                className="w-full accent-yellow-600 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer hover:bg-stone-600 transition-colors"
              />
           </div>
        </div>
    );
};

// --- DYNAMIC FORM COMPONENT ---

const DynamicForm = ({ 
    schema, 
    onSubmit 
}: { 
    schema: FormSchema, 
    onSubmit: (values: Record<string, string | string[]>) => void 
}) => {
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleInputChange = (id: string, value: string) => {
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleCheckboxChange = (id: string, option: string, max: number) => {
        setFormData(prev => {
            const current = prev[id] || [];
            if (current.includes(option)) {
                return { ...prev, [id]: current.filter((item: string) => item !== option) };
            } else {
                if (max && current.length >= max) return prev; // Limit reached
                return { ...prev, [id]: [...current, option] };
            }
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        // Format the submission for the AI
        onSubmit(formData);
    };

    return (
        <div className="mt-6 bg-[#1a1816] border border-yellow-900/30 rounded-sm p-5 shadow-2xl animate-fade-in relative overflow-hidden">
             {/* Decorative Header */}
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-800 to-transparent"></div>
             <div className="mb-6 text-center">
                 <h3 className="text-yellow-600 font-fantasy text-lg tracking-widest uppercase border-b border-stone-800 pb-2 inline-block px-8">
                    {schema.titulo}
                 </h3>
             </div>

             <form onSubmit={handleSubmit} className="space-y-6">
                {schema.fields.map((field) => (
                    <div key={field.id} className="flex flex-col gap-2">
                        <label className="text-stone-400 text-sm font-bold uppercase tracking-wider">
                            {field.label}
                            {field.max_select && <span className="text-[10px] text-stone-600 ml-2">(Max: {field.max_select})</span>}
                        </label>
                        
                        {field.type === 'text' && (
                            <input 
                                type="text"
                                placeholder={field.placeholder}
                                value={formData[field.id] || ''}
                                onChange={(e) => handleInputChange(field.id, e.target.value)}
                                className="bg-stone-900/50 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif placeholder-stone-600"
                            />
                        )}

                        {field.type === 'select' && field.options && (
                             <select
                                value={formData[field.id] || ''}
                                onChange={(e) => handleInputChange(field.id, e.target.value)}
                                className="bg-stone-900/50 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif"
                             >
                                <option value="">Selecione uma opção...</option>
                                {field.options.map((opt, idx) => (
                                    <option key={idx} value={opt}>{opt}</option>
                                ))}
                             </select>
                        )}

                        {field.type === 'radio' && field.options && (
                            <div className="flex flex-col gap-2 pl-2">
                                {field.options.map((opt, idx) => (
                                    <label key={idx} className="flex items-center gap-3 cursor-pointer group">
                                        <div className={`w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center group-hover:border-yellow-600 ${formData[field.id] === opt ? 'border-yellow-600' : ''}`}>
                                            {formData[field.id] === opt && <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>}
                                        </div>
                                        <input 
                                            type="radio" 
                                            name={field.id} 
                                            value={opt}
                                            checked={formData[field.id] === opt}
                                            onChange={() => handleInputChange(field.id, opt)}
                                            className="hidden"
                                        />
                                        <span className={`text-sm ${formData[field.id] === opt ? 'text-yellow-500' : 'text-stone-500 group-hover:text-stone-300'}`}>{opt}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {field.type === 'checkbox' && field.options && (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-2">
                                {field.options.map((opt, idx) => {
                                    const isSelected = (formData[field.id] || []).includes(opt);
                                    return (
                                        <label key={idx} className="flex items-center gap-3 cursor-pointer group bg-stone-900/30 p-2 rounded hover:bg-stone-900/60 transition-colors">
                                            <div className={`w-4 h-4 rounded border border-stone-600 flex items-center justify-center ${isSelected ? 'bg-yellow-900 border-yellow-700' : ''}`}>
                                                {isSelected && <span className="text-xs text-yellow-200">✓</span>}
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={isSelected}
                                                onChange={() => handleCheckboxChange(field.id, opt, field.max_select || 99)}
                                                className="hidden"
                                            />
                                            <span className={`text-sm ${isSelected ? 'text-yellow-200' : 'text-stone-500'}`}>{opt}</span>
                                        </label>
                                    );
                                })}
                             </div>
                        )}
                    </div>
                ))}

                <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-4 bg-yellow-900/20 hover:bg-yellow-900/40 border border-yellow-900/50 text-yellow-500 font-bold py-3 rounded uppercase tracking-widest transition-all hover:scale-[1.01]"
                >
                    {isSubmitting ? "Enviando..." : "Confirmar Ficha"}
                </button>
             </form>
        </div>
    );
}

// --- NEW LAYOUT COMPONENTS ---

const GameHeader = ({ 
    location,
    audioState,
    setAudioState,
    volumeState,
    setVolumeState
}: { 
    location: string,
    audioState: { isMuted: boolean, isNarrationEnabled: boolean, isNarrating: boolean, showSettings: boolean },
    setAudioState: any,
    volumeState: { music: number, narration: number },
    setVolumeState: any
}) => {
    return (
        <header className="h-16 flex-none bg-[#0e0c0b] border-b border-[#3e352f] flex items-center justify-between px-6 shadow-lg z-30">
            {/* Left: Title */}
            <div className="font-fantasy text-lg md:text-xl text-[#dcd0c0] tracking-widest font-bold">
                <span className="text-red-900 mr-2">✦</span>
                Ecos de Karameikos
            </div>

            {/* Center: Location (Hidden on small mobile) */}
            <div className="hidden md:flex items-center gap-2 text-stone-400 bg-stone-900/50 px-4 py-1 rounded-full border border-stone-800">
                <span>📍</span>
                <span className="font-fantasy tracking-wide text-sm">{location}</span>
            </div>

            {/* Right: Audio Controls */}
            <div className="flex items-center gap-4 relative">
                <button 
                    onClick={() => setAudioState({...audioState, isMuted: !audioState.isMuted})}
                    className={`text-xl transition-colors ${audioState.isMuted ? 'text-stone-600' : 'text-stone-300 hover:text-white'}`}
                    title={audioState.isMuted ? "Ativar Som" : "Silenciar"}
                >
                    {audioState.isMuted ? "🔇" : "🔊"}
                </button>

                <button 
                    onClick={() => setAudioState({...audioState, isNarrationEnabled: !audioState.isNarrationEnabled})}
                    className={`text-xl transition-colors relative ${audioState.isNarrationEnabled ? 'text-stone-300 hover:text-white' : 'text-stone-600'}`}
                    title="Narração"
                >
                    {audioState.isNarrationEnabled ? "🗣️" : "😶"}
                    {audioState.isNarrating && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                        </span>
                    )}
                </button>

                <div className="relative">
                    <button 
                        onClick={() => setAudioState({...audioState, showSettings: !audioState.showSettings})}
                        className={`text-xl transition-colors ${audioState.showSettings ? 'text-white' : 'text-stone-500 hover:text-stone-300'}`}
                        title="Configurações"
                    >
                        ⚙️
                    </button>
                    <VolumeSettingsPopup 
                        isOpen={audioState.showSettings}
                        musicVolume={volumeState.music}
                        setMusicVolume={(v) => setVolumeState({...volumeState, music: v})}
                        narrationVolume={volumeState.narration}
                        setNarrationVolume={(v) => setVolumeState({...volumeState, narration: v})}
                    />
                </div>
            </div>
        </header>
    );
};

const CharacterSidebar = ({ status }: { status: GameStatus }) => {
    // Parse HP for bar visualization
    let hpPercent = 100;
    try {
        const [current, max] = status.hp.split('/').map(s => parseInt(s.replace(/[^0-9]/g, '')));
        if (!isNaN(current) && !isNaN(max) && max > 0) {
            hpPercent = Math.max(0, Math.min(100, (current / max) * 100));
        } else if (status.hp.includes("?")) {
            hpPercent = 100; // Full bar for unknown
        }
    } catch(e) {}

    return (
        <aside className="w-72 flex-none bg-[#161412] border-r border-[#3e352f] flex flex-col hidden lg:flex shadow-xl z-20">
            {/* Avatar Section */}
            <div className="p-6 border-b border-[#2a2622] flex flex-col items-center">
                <div className="w-32 h-32 rounded-full border-4 border-[#3e352f] overflow-hidden shadow-2xl bg-black mb-4">
                    <img 
                        src="https://via.placeholder.com/256/2a2622/5c5042?text=Heroi" 
                        alt="Avatar" 
                        className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"
                    />
                </div>
                <h2 className="font-fantasy text-[#dcd0c0] text-xl tracking-widest text-center">Aventureiro</h2>
                <div className="text-stone-500 text-xs uppercase tracking-wide mt-1">Nível 1 • Desconhecido</div>
            </div>

            {/* Stats Section */}
            <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                
                {/* HP */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs uppercase tracking-widest font-bold text-stone-400">
                        <span>Vitalidade</span>
                        <span>{status.hp}</span>
                    </div>
                    <div className="h-2 bg-stone-900 rounded-full overflow-hidden border border-stone-800">
                        <div 
                            className="h-full bg-red-900 transition-all duration-500" 
                            style={{width: `${hpPercent}%`}}
                        ></div>
                    </div>
                </div>

                {/* Quest Box */}
                <div className="bg-[#1e1c19] border border-[#3e352f] p-4 rounded-sm relative group">
                    <div className="absolute -top-2 left-3 bg-[#1e1c19] px-2 text-[10px] text-yellow-700 font-bold uppercase tracking-widest">
                        Missão Atual
                    </div>
                    <p className="text-stone-400 text-sm font-serif italic leading-relaxed">
                        "{status.quest}"
                    </p>
                </div>

                 {/* Inventory Mockup */}
                 <div className="space-y-3">
                    <h3 className="text-[10px] text-stone-500 uppercase tracking-widest font-bold border-b border-stone-800 pb-1">
                        Inventário Rápido
                    </h3>
                    <ul className="space-y-2">
                        <li className="flex items-center gap-3 text-stone-400 text-sm p-2 hover:bg-stone-900/50 rounded transition-colors cursor-help border border-transparent hover:border-stone-800">
                            <span className="text-lg">🗡️</span>
                            <span>Adaga Simples</span>
                        </li>
                        <li className="flex items-center gap-3 text-stone-400 text-sm p-2 hover:bg-stone-900/50 rounded transition-colors cursor-help border border-transparent hover:border-stone-800">
                            <span className="text-lg">🎒</span>
                            <span>Mochila de Viagem</span>
                        </li>
                        <li className="flex items-center gap-3 text-stone-400 text-sm p-2 hover:bg-stone-900/50 rounded transition-colors cursor-help border border-transparent hover:border-stone-800">
                            <span className="text-lg">🪙</span>
                            <span>15 Peças de Ouro</span>
                        </li>
                    </ul>
                 </div>
            </div>
        </aside>
    );
};

// Re-using updated components
const SaveBlock = ({ content }: { content: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="mt-4 bg-[#1a1816] border border-yellow-900/40 rounded-lg p-4 relative overflow-hidden group">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-900/60 to-transparent"></div>
             
             <div className="flex justify-between items-center mb-2">
                 <h4 className="text-yellow-700 font-fantasy tracking-widest text-xs uppercase">Checkpoint de Resgate</h4>
                 <button 
                    onClick={handleCopy}
                    className={`text-xs px-3 py-1 rounded border transition-all ${
                        copied 
                        ? 'bg-green-900/30 text-green-400 border-green-800' 
                        : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-600'
                    }`}
                 >
                    {copied ? "Copiado!" : "Copiar Código"}
                 </button>
             </div>

             <pre className="font-mono text-[10px] md:text-xs text-stone-400 whitespace-pre-wrap break-all bg-black/20 p-2 rounded max-h-40 overflow-y-auto custom-scrollbar">
                {content}
             </pre>
             <p className="text-[10px] text-stone-600 mt-2 italic">
                Copie este código e cole-o no início de uma nova sessão para continuar sua jornada.
             </p>
        </div>
    );
}

const ChatMessage: React.FC<{ msg: Message; onOptionSelect?: (value: string) => void }> = ({ msg, onOptionSelect }) => {
  let displayText = msg.text;
  displayText = displayText.replace(/---\s*\*\*STATUS DO GRUPO:\*\*[\s\S]*?---/g, "");
  displayText = displayText.replace(/--- \[OPCOES\] ---[\s\S]*/g, "");
  displayText = displayText.replace(/--- \[(CENA VISUAL SUGERIDA|AMBIENTE SONORO)\] ---[\s\S]*?(?=\n---|$)/g, "");
  
  // Remove form JSON block from display text
  displayText = displayText.replace(/--- \[FORMULARIO\] ---[\s\S]*/g, "");

  // Convert dice roll brackets to inline code for styling logic
  // Captures [🎲 ...], [🩸 ...], [🦶 ...], [⚡ ...]
  displayText = displayText.replace(/(\[(?:🎲|🩸|🦶|⚡).*?\])/g, '`$1`');

  const saveBlockRegex = /```\s*\[CHECKPOINT_KARAMEIKOS\][\s\S]*?```/;
  const saveMatch = displayText.match(saveBlockRegex);
  let saveContent = null;
  
  if (saveMatch) {
      saveContent = saveMatch[0].replace(/```/g, "").trim();
      displayText = displayText.replace(saveBlockRegex, "");
  }

  displayText = displayText.trim();

  if (!displayText && !msg.imageUrl && !msg.isGeneratingImage && !saveContent && !msg.isSavePoint && !msg.form) return null;

  const isUser = msg.role === "user";

  const handleFormSubmit = (data: Record<string, string | string[]>) => {
      // Build a readable string from the form data
      let responseStr = `FICHA PREENCHIDA - ${msg.form?.titulo}:\n`;
      Object.entries(data).forEach(([key, val]) => {
          const field = msg.form?.fields.find(f => f.id === key);
          const label = field ? field.label : key;
          const valStr = Array.isArray(val) ? val.join(", ") : val;
          responseStr += `* ${label}: ${valStr}\n`;
      });
      
      onOptionSelect?.(responseStr);
  };

  return (
    <div className={`flex w-full mb-8 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] md:max-w-[80%] ${isUser ? "pl-12" : "pr-12"} relative group`}>
        {/* Role Badge */}
        <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isUser ? "text-stone-500 text-right" : "text-yellow-900/80"}`}>
          {isUser ? "Você" : "Mestre dos Calabouços"}
        </div>
        
        {/* Message Bubble */}
        <div
            className={`rounded-sm shadow-xl overflow-hidden p-6 relative ${
            isUser
                ? "bg-stone-800/80 border-l-2 border-stone-600 text-stone-300"
                : "bg-[#25221e] border-l-2 border-yellow-900/30 text-[#dcd0c0]"
            }`}
        >
             <div className={`markdown-body text-base leading-7 font-serif ${isUser ? "" : ""}`}>
                <ReactMarkdown
                    components={{
                        p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1 text-stone-400" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1 text-stone-400" {...props} />,
                        li: ({node, ...props}) => <li className="pl-1" {...props} />,
                        strong: ({node, ...props}) => <strong className="text-[#e6dfd3] font-bold" {...props} />,
                        em: ({node, ...props}) => <em className="text-[#c4b59d]" {...props} />,
                        blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-yellow-900/30 pl-4 italic text-stone-500 my-4" {...props} />,
                        code: ({node, className, children, ...props}) => {
                             const content = String(children).replace(/\n$/, '');
                             // Check if content matches our dice pattern
                             const isDiceRoll = /^\[(?:🎲|🩸|🦶|⚡)/.test(content);
                             
                             if (isDiceRoll) {
                                 return <span className="dice-roll">{content}</span>;
                             }
                             return <code className="bg-black/30 text-yellow-600 px-1 rounded font-mono text-xs" {...props}>{children}</code>
                        },
                    }}
                >
                    {displayText}
                </ReactMarkdown>
            </div>

            {saveContent && <SaveBlock content={saveContent} />}
            
            {/* Dynamic Form Rendering */}
            {msg.form && (
                <DynamicForm schema={msg.form} onSubmit={handleFormSubmit} />
            )}

            {(msg.imageUrl || msg.isGeneratingImage) && (
                <div className="w-full mt-6 relative border-t border-[#3e352f]/50 pt-4">
                    {msg.imageUrl ? (
                        <div className="relative group/img overflow-hidden rounded-sm border border-[#3e352f]">
                            <img 
                                src={msg.imageUrl} 
                                alt="Cena gerada pela IA" 
                                className="w-full h-auto object-cover max-h-[400px] animate-fade-in transition-transform duration-700 group-hover/img:scale-105"
                            />
                            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4">
                                <span className="text-[10px] text-stone-400 font-fantasy tracking-widest uppercase">Visualização da Cena</span>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-48 bg-black/20 flex flex-col items-center justify-center gap-3 text-stone-600 animate-pulse rounded-sm border border-stone-800/50 border-dashed">
                            <div className="w-6 h-6 border-2 border-stone-600 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-[10px] font-fantasy tracking-widest uppercase">Invocando Visão...</span>
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Inline Options (Still kept for context flow, but styled better) */}
        {msg.options && msg.options.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-2 animate-fade-in pl-4 border-l border-stone-700 ml-6">
             {msg.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => onOptionSelect?.(option.value)}
                  className="text-left bg-stone-900 hover:bg-[#2a2622] border border-stone-700 hover:border-yellow-900/50 rounded-r-lg p-3 transition-all group"
                >
                  <div className="text-stone-300 font-fantasy text-sm font-bold group-hover:text-yellow-500 mb-1 flex items-center gap-2">
                      <span className="text-[10px] text-stone-600 group-hover:text-yellow-900">➤</span>
                      {option.label}
                  </div>
                  {option.sub && <div className="text-stone-500 text-xs italic ml-5 group-hover:text-stone-400">{option.sub}</div>}
                </button>
             ))}
          </div>
        )}
      </div>
    </div>
  );
};

const DiceLogSidebar = ({ history, isOpen, onClose }: { history: RollEntry[], isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;
  
    return (
      <div className="absolute top-16 right-0 bottom-20 w-64 bg-[#1e1c19] border-l border-[#3e352f] shadow-2xl z-40 flex flex-col animate-fade-in">
        <div className="p-4 border-b border-[#3e352f] flex justify-between items-center bg-[#25221e]">
          <h3 className="font-fantasy text-[#dcd0c0] text-sm tracking-widest uppercase">Registro do Destino</h3>
          <button onClick={onClose} className="text-stone-500 hover:text-red-400 text-xl font-bold">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {history.length === 0 && (
            <p className="text-stone-600 text-xs italic text-center mt-10">O destino ainda não foi testado.</p>
          )}
          {history.slice().reverse().map((roll) => {
            const isCritSuccess = roll.die === 'd20' && roll.result === 20;
            const isCritFail = roll.die === 'd20' && roll.result === 1;
            
            return (
              <div key={roll.id} className="flex justify-between items-center border-b border-stone-800/50 pb-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-stone-600 font-mono">{roll.timestamp}</span>
                  <span className="text-sm text-stone-400 font-bold font-serif">{roll.die}</span>
                </div>
                <div className={`text-xl font-fantasy ${
                  isCritSuccess ? 'text-yellow-500 drop-shadow-[0_0_5px_rgba(234,179,8,0.5)]' :
                  isCritFail ? 'text-red-600 drop-shadow-[0_0_5px_rgba(220,38,38,0.5)]' : 'text-[#dcd0c0]'
                }`}>
                  {roll.result}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

const App = () => {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'init', 
      role: "model", 
      text: INITIAL_GREETING, 
      options: CHARACTER_OPTIONS 
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [gameStatus, setGameStatus] = useState<GameStatus>({
    location: "Estrada de Threshold",
    hp: "20/20",
    quest: "Sobreviver em Karameikos",
  });
  const [currentSound, setCurrentSound] = useState<string>("MUSICA"); 
  
  // Audio & Volume State
  const [audioState, setAudioState] = useState({
      isMuted: false,
      isNarrationEnabled: false,
      isNarrating: false,
      showSettings: false
  });
  const [volumeState, setVolumeState] = useState({
      music: 0.5,
      narration: 1.0
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const narrationGainNodeRef = useRef<GainNode | null>(null);
  const lastNarratedMsgIdRef = useRef<string>("");

  // Dice History State
  const [rollHistory, setRollHistory] = useState<RollEntry[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<any>(null); 

  // Initialize AI
  useEffect(() => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const chat = ai.chats.create({
      model: MODEL_NAME,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.9, 
        tools: [{ codeExecution: {} }],
      },
      history: [
        {
          role: "model",
          parts: [{ text: INITIAL_GREETING }],
        },
      ],
    });
    aiRef.current = chat;
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
         chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages]);

  // Update narration gain when volume changes
  useEffect(() => {
      if (narrationGainNodeRef.current) {
          narrationGainNodeRef.current.gain.value = volumeState.narration;
      }
  }, [volumeState.narration]);

  // --- TTS LOGIC ---
  const playNarrative = async (text: string) => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }

    if (!narrationGainNodeRef.current) {
        narrationGainNodeRef.current = ctx.createGain();
        narrationGainNodeRef.current.gain.value = volumeState.narration;
        narrationGainNodeRef.current.connect(ctx.destination);
    }

    setAudioState(prev => ({...prev, isNarrating: true}));
    try {
      let cleanText = text
        .replace(/---\s*\*\*STATUS DO GRUPO:\*\*[\s\S]*?---/g, "")
        .replace(/--- \[OPCOES\] ---[\s\S]*/g, "")
        .replace(/--- \[(CENA VISUAL SUGERIDA|AMBIENTE SONORO)\] ---[\s\S]*?(?=\n---|$)/g, "")
        .replace(/--- \[FORMULARIO\] ---[\s\S]*/g, "")
        .replace(/```\s*\[CHECKPOINT_KARAMEIKOS\][\s\S]*?```/g, "")
        .replace(/[\*\_#\[\]]/g, "") 
        .trim();

      if (!cleanText) return;

      let script = cleanText.replace(/([“"])(.*?)([”"])/g, (match, q1, content, q2) => {
          return `\nNPC: ${content}\nDM: `;
      });
      script = `DM: ${script}`;
      
      script = script.replace(/DM:\s*DM:/g, "DM:").replace(/DM:\s*$/g, "");
      
      const prompt = `TTS the following conversation between DM and NPC:\n${script}`;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: TTS_MODEL_NAME,
        contents: { parts: [{ text: prompt }] },
        config: {
            responseModalities: ['AUDIO'], 
            speechConfig: {
                multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: [
                        {
                            speaker: 'DM',
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } 
                        },
                        {
                            speaker: 'NPC',
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } 
                        }
                    ]
                }
            }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
         const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000);
         const source = ctx.createBufferSource();
         source.buffer = audioBuffer;
         if (narrationGainNodeRef.current) {
             source.connect(narrationGainNodeRef.current);
         } else {
             source.connect(ctx.destination);
         }
         source.start();
         
         source.onended = () => setAudioState(prev => ({...prev, isNarrating: false}));
      } else {
         setAudioState(prev => ({...prev, isNarrating: false}));
      }

    } catch (e) {
      console.error("TTS Error:", e);
      setAudioState(prev => ({...prev, isNarrating: false}));
    }
  };

  useEffect(() => {
    if (!audioState.isNarrationEnabled) return;

    const lastMsg = messages[messages.length - 1];
    
    if (
        lastMsg && 
        lastMsg.role === "model" && 
        !lastMsg.isStreaming && 
        lastMsg.id !== lastNarratedMsgIdRef.current &&
        !isLoading 
    ) {
        lastNarratedMsgIdRef.current = lastMsg.id;
        playNarrative(lastMsg.text);
    }
  }, [messages, audioState.isNarrationEnabled, isLoading]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "model" && !lastMsg.isStreaming) {
      const statusRegex = /STATUS DO GRUPO:\*\*\s*\n\*\s*\*\*Local:\*\*\s*(.*?)\n\*\s*\*\*PV:\*\*\s*(.*?)\n\*\s*\*\*Missão Atual:\*\*\s*(.*?)\n/s;
      const statusMatch = lastMsg.text.match(statusRegex);
      
      if (statusMatch) {
        setGameStatus({
          location: statusMatch[1].trim(),
          hp: statusMatch[2].trim(),
          quest: statusMatch[3].trim(),
        });
      }

      const audioRegex = /--- \[AMBIENTE SONORO\] ---\s*\n\*\*Som:\*\*\s*(.*?)(?=\n---|$)/s;
      const audioMatch = lastMsg.text.match(audioRegex);

      if (audioMatch) {
        const soundKey = audioMatch[1].trim();
        setCurrentSound(soundKey);
      }

      const optionsRegex = /--- \[OPCOES\] ---\s*(\[[\s\S]*?\])/;
      const optionsMatch = lastMsg.text.match(optionsRegex);

      if (optionsMatch && !lastMsg.options) {
        try {
          const jsonStr = optionsMatch[1];
          const parsedOptions = JSON.parse(jsonStr) as Option[];
          
          if (Array.isArray(parsedOptions) && parsedOptions.length > 0) {
            setMessages(prev => {
              const newMessages = [...prev];
              const msgIndex = newMessages.length - 1;
              if (newMessages[msgIndex].id === lastMsg.id) {
                newMessages[msgIndex] = {
                  ...newMessages[msgIndex],
                  options: parsedOptions
                };
              }
              return newMessages;
            });
          }
        } catch (e) {
          console.error("Failed to parse options JSON", e);
        }
      }

      // --- FORM PARSING ---
      const formRegex = /--- \[FORMULARIO\] ---\s*(\{[\s\S]*?\})/;
      const formMatch = lastMsg.text.match(formRegex);

      if (formMatch && !lastMsg.form) {
          try {
              const jsonStr = formMatch[1];
              const parsedForm = JSON.parse(jsonStr) as FormSchema;
              
              setMessages(prev => {
                  const newMessages = [...prev];
                  const msgIndex = newMessages.length - 1;
                  if (newMessages[msgIndex].id === lastMsg.id) {
                      newMessages[msgIndex] = {
                          ...newMessages[msgIndex],
                          form: parsedForm
                      };
                  }
                  return newMessages;
              });
          } catch(e) {
              console.error("Failed to parse form JSON", e);
          }
      }
    }
  }, [messages]);

  const generateSceneImage = async (prompt: string): Promise<string | null> => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
           imageConfig: { aspectRatio: "16:9" }
        }
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    } catch (e) {
      console.error("Failed to generate image", e);
    }
    return null;
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading || !aiRef.current) return;

    if (!audioContextRef.current) {
         audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }

    const userMsgId = Date.now().toString();
    const userMsg: Message = { id: userMsgId, role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);
    
    try {
      const result = await aiRef.current.sendMessageStream({ message: text });
      
      let fullText = "";
      const modelMsgId = (Date.now() + 1).toString();
      
      setMessages((prev) => [
        ...prev,
        { id: modelMsgId, role: "model", text: "", isStreaming: true },
      ]);

      for await (const chunk of result) {
        const chunkText = chunk.text;
        fullText += chunkText;
        
        setMessages((prev) => {
          const newMessages = [...prev];
          const msgIndex = newMessages.findIndex(m => m.id === modelMsgId);
          if (msgIndex !== -1) {
            newMessages[msgIndex] = { ...newMessages[msgIndex], text: fullText };
          }
          return newMessages;
        });
      }

      const promptRegex = /--- \[CENA VISUAL SUGERIDA\] ---\s*\n\*\*Prompt para Gerador:\*\*\s*(.*?)(?=\n---|$)/s;
      const match = fullText.match(promptRegex);

      if (match) {
        const prompt = match[1].trim();
        setMessages((prev) => {
           const newMessages = [...prev];
           const msgIndex = newMessages.findIndex(m => m.id === modelMsgId);
           if (msgIndex !== -1) {
               newMessages[msgIndex] = { ...newMessages[msgIndex], isGeneratingImage: true, isStreaming: false };
           }
           return newMessages;
        });

        generateSceneImage(prompt).then((url) => {
             setMessages((prev) => {
                const newMessages = [...prev];
                const msgIndex = newMessages.findIndex(m => m.id === modelMsgId);
                if (msgIndex !== -1) {
                    newMessages[msgIndex] = { 
                        ...newMessages[msgIndex], 
                        isGeneratingImage: false, 
                        imageUrl: url || undefined 
                    };
                }
                return newMessages;
             });
        });
      } else {
          setMessages((prev) => {
            const newMessages = [...prev];
            const msgIndex = newMessages.findIndex(m => m.id === modelMsgId);
            if (msgIndex !== -1) {
                newMessages[msgIndex] = { ...newMessages[msgIndex], isStreaming: false };
            }
            return newMessages;
          });
      }

    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "model", text: "*O Mestre silencia por um momento... (Erro de conexão)*" },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveGame = () => {
      handleSendMessage("(Sistema) Gere um 'CHECKPOINT_KARAMEIKOS' completo seguindo o formato definido nas instruções.");
  };

  const handleDiceRoll = (die: string, result: number) => {
    const rollText = `[Rolou ${die}: ${result}]`;
    handleSendMessage(rollText);

    const newRoll: RollEntry = {
      id: Date.now().toString(),
      die,
      result,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    setRollHistory(prev => [...prev, newRoll]);
  };

  const dice = [4, 6, 8, 10, 12, 20];
  const diceDescriptions: Record<number, string> = {
      4: "d4: Dano de armas leves e poções",
      6: "d6: Testes de atributos clássicos e dano curto",
      8: "d8: Dano de armas médias",
      10: "d10: Dano de armas pesadas",
      12: "d12: Dano de bárbaro",
      20: "d20: Testes Principais"
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#12100e] overflow-hidden">
      <BackgroundMusic currentSound={currentSound} isMuted={audioState.isMuted} volume={volumeState.music} />

      {/* --- 1. Top Bar (Header) --- */}
      <GameHeader 
         location={gameStatus.location}
         audioState={audioState}
         setAudioState={setAudioState}
         volumeState={volumeState}
         setVolumeState={setVolumeState}
      />

      {/* --- 2. Body Area (Sidebar + Main) --- */}
      <div className="flex-1 flex overflow-hidden relative">
          
          {/* Sidebar (Left Panel) */}
          <CharacterSidebar status={gameStatus} />

          {/* Main Content (Chat) */}
          <main className="flex-1 flex flex-col relative min-w-0 bg-stone-900/20">
              <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar scroll-smooth">
                  <div className="max-w-4xl mx-auto pb-6">
                      {messages.map((msg) => (
                          <ChatMessage key={msg.id} msg={msg} onOptionSelect={handleSendMessage} />
                      ))}
                      <div ref={chatEndRef} />
                  </div>
              </div>
          </main>
          
          {/* Dice Log Drawer (Absolute over Main) */}
          <DiceLogSidebar 
            history={rollHistory} 
            isOpen={isLogOpen} 
            onClose={() => setIsLogOpen(false)} 
          />
      </div>

      {/* --- 3. Footer (Action Deck) --- */}
      <footer className="bg-[#0e0c0b] border-t border-[#3e352f] p-4 flex-none z-30 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
         <div className="max-w-5xl mx-auto flex flex-col gap-3">
            
            {/* Control Row: Dice + Tools */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
                    <button
                      onClick={() => setIsLogOpen(!isLogOpen)}
                      className="w-10 h-10 flex items-center justify-center bg-stone-900 hover:bg-stone-800 border border-stone-700 rounded text-stone-400 transition-colors shrink-0"
                      title="Ver Histórico de Rolagens"
                    >
                      <span className="text-xl">📜</span>
                    </button>
                    <button
                      onClick={handleSaveGame}
                      className="w-10 h-10 flex items-center justify-center bg-stone-900 hover:bg-stone-800 border border-stone-700 rounded text-stone-400 transition-colors shrink-0"
                      title="Salvar Jogo"
                      disabled={isLoading}
                    >
                      <span className="text-xl">💾</span>
                    </button>
                    
                    <div className="h-8 w-px bg-stone-800 mx-2 shrink-0"></div>
                    
                    {dice.map((d) => (
                        <button
                          key={d}
                          onClick={() => handleDiceRoll(`d${d}`, Math.floor(Math.random() * d) + 1)}
                          className="w-10 h-10 flex flex-col items-center justify-center bg-[#1e1c19] hover:bg-red-900 border border-stone-700 hover:border-red-600 rounded text-stone-300 transition-all shrink-0 group relative overflow-hidden"
                          title={diceDescriptions[d]}
                        >
                          <span className="text-[10px] font-bold opacity-50 absolute top-0.5">d{d}</span>
                          <span className="text-lg font-fantasy group-hover:scale-110 transition-transform">🎲</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Input Row */}
            <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage(inputValue);
                }}
                className="flex gap-4 w-full"
            >
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="O que você deseja fazer?"
                  disabled={isLoading}
                  className="flex-1 bg-[#1a1816] text-[#dcd0c0] border border-stone-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-700 focus:ring-1 focus:ring-yellow-700 transition-all placeholder-stone-600 font-serif text-lg"
                />
                <button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="bg-red-900 hover:bg-red-800 text-stone-200 font-bold px-8 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-fantasy tracking-widest border border-red-950 shadow-lg text-lg"
                >
                  {isLoading ? "..." : "AGIR"}
                </button>
            </form>
         </div>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);