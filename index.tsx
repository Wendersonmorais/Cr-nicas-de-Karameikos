import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import ReactMarkdown from "react-markdown";

// --- Polyfill for process.env in browser environment ---
if (typeof process === 'undefined') {
  (window as any).process = { env: { API_KEY: '' } };
}

// --- Types ---

type Option = {
    label: string;
    value: string;
    sub?: string;
};

type FormField = {
    id: string;
    type: "text" | "select" | "radio" | "checkbox";
    label: string;
    placeholder?: string;
    defaultValue?: string; 
    options?: string[];
    max_select?: number; 
};

type FormSchema = {
    titulo: string;
    fields: FormField[];
};

type PregenCharacter = {
    id: string;
    nome: string;
    raca: string;
    classe: string;
    stats: { for: number; des: number; con: number; int: number; sab: number; car: number };
    hp: number;
    equip: string[];
    desc: string;
    role: string; // Tank, DPS, Healer, Utility
};

type ItemObtainedData = {
    item_name: string;
    quantity: number;
    description: string;
    rarity?: "common" | "uncommon" | "rare" | "legendary";
    icon?: "weapon" | "potion" | "armor" | "misc";
};

type DiceRollData = {
    roll_name: string;
    d20_result: number;
    modifier: number;
    proficiency: number;
    total_value: number;
    is_critical: boolean;
    is_success: boolean;
};

type CombatHitData = {
    target: string;
    damage: number;
    damage_type: string;
    is_critical: boolean;
};

type GameEvent = {
    type: "none" | "dice_roll" | "combat_hit" | "item_obtained";
    data: DiceRollData | CombatHitData | ItemObtainedData | any;
};

type Combatant = {
    name: string;
    hp: number;
    max_hp: number;
    is_active: boolean;
    avatar?: string;
};

type CombatState = {
    round: number;
    turn_order: Combatant[];
};

// Interface atualizada para Membros do Grupo
interface GroupMember {
  nome: string;
  classe: string;
  status: string; // "Vivo", "Ferido", "Inconsciente"
  avatar?: string;
  raca?: string; 
}

interface Quest {
  id: string;
  titulo: string;
  descricao: string;
  status: "ativa" | "completa" | "falha";
}

type GameStatus = {
    nome: string;
    titulo: string;
    hp_atual: number;
    hp_max: number;
    armor_class: number;
    local: string;
    missao: string;
    inventario: string[];
    atributos?: Record<string, string>;
    combat?: CombatState;
    avatarUrl?: string;
    grupo?: GroupMember[]; 
    talentos?: string[]; 
    missoes_ativas?: Quest[];
    // Sistema de Facções Expandido (Política de Guerra)
    reputacao?: { 
        thyatis: number; 
        traladara: number;
        igreja_karameikos?: number;
        ordem_grifo?: number;
        elfos_callarii?: number;
    }; 
    pistas_descobertas?: string[]; // Sistema de Mistério
};

type GameResponse = {
    narrative: string;
    status_jogador?: Partial<GameStatus>;
    combat_state?: CombatState;
    game_event?: GameEvent;
    quick_actions?: string[];
    update_avatar?: { trigger: boolean; visual_prompt: string };
    
    // Engine de Cenários
    update_scene?: { 
        trigger: boolean; 
        visual_prompt: string; 
        style?: string; 
    };
    
    interface?: {
        modo: "texto_livre" | "botoes" | "rolagem" | "formulario" | "selecao_fichas";
        permitir_input_livre?: boolean;
        conteudo?: Option[] | FormSchema; 
    };
};

type Message = {
    id: string;
    role: "user" | "model" | "system";
    text: string;
    gameResponse?: GameResponse;
    options?: Option[];
    imageUrl?: string;
    form?: FormSchema;
    showPregen?: boolean;
};

// --- Constants ---

const MODEL_NAME = "gemini-2.5-flash";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";

// Dados extraídos do PDF "Mystara - Karameikos Fichas" e adaptados para 5e
const PREGEN_CHARACTERS: PregenCharacter[] = [
    {
        id: "001",
        nome: "Valerius Vorloi",
        raca: "Humano (Thyatiano)",
        classe: "Guerreiro (Cavaleiro)",
        stats: { for: 16, des: 10, con: 15, int: 10, sab: 13, car: 14 },
        hp: 12,
        equip: ["Espada Longa", "Escudo com Brasão", "Cota de Malhas", "Kit de Viajante"],
        desc: "Nobreza decaída, busca restaurar a honra da família. Disciplinado e leal ao Duque.",
        role: "🛡️ Tanque / Defensivo"
    },
    {
        id: "002",
        nome: "Dmitri Torenescu",
        raca: "Humano (Traladarano)",
        classe: "Ladino (Lâmina)",
        stats: { for: 10, des: 16, con: 12, int: 14, sab: 13, car: 15 },
        hp: 9,
        equip: ["Rapieira", "Adaga Curva", "Armadura de Couro", "Baralho de Tarokka"],
        desc: "Cresceu nas ruas do 'Ninho'. Odeia a guarda da cidade. Rápido e mortal.",
        role: "🗡️ Furtivo / Dano Rápido"
    },
    {
        id: "003",
        nome: "Syllina Argenthos",
        raca: "Humana (Traladarana)",
        classe: "Clérigo (Igreja de Karameikos)",
        stats: { for: 13, des: 10, con: 14, int: 12, sab: 16, car: 14 },
        hp: 10,
        equip: ["Maça Estrela", "Cota de Escamas", "Símbolo Sagrado", "Unguentos"],
        desc: "Missionária tentando apaziguar os ânimos entre os povos. Cura aliados e bane mortos-vivos.",
        role: "❤️ Suporte / Cura"
    },
    {
        id: "004",
        nome: "Elara de Callarii",
        raca: "Elfa (Floresta)",
        classe: "Mago (Evocação)",
        stats: { for: 8, des: 16, con: 12, int: 17, sab: 14, car: 10 },
        hp: 7,
        equip: ["Cajado de Carvalho", "Grimório Élfico", "Adaga", "Manto Verde"],
        desc: "Uma emissária dos elfos de Radlebb. Sua magia é tão bela quanto mortal.",
        role: "🔥 Controle Arcano"
    },
    {
        id: "005",
        nome: "Thorin Escudo-de-Ferro",
        raca: "Anão (Forte)",
        classe: "Guerreiro (Campeão)",
        stats: { for: 17, des: 13, con: 16, int: 10, sab: 12, car: 8 },
        hp: 13,
        equip: ["Machado de Batalha", "Machadinha", "Cota de Malhas Pesada"],
        desc: "Um mercenário das Montanhas Cruth. Fala pouco, bate forte.",
        role: "⚔️ Dano Pesado"
    }
];

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é um Motor de Jogo (Game Engine) e Mestre de RPG narrando a campanha "Tirania dos Dracos em Karameikos" (D&D 5e).
Seu estilo é "Grim Dark Fantasy" com foco em **GUERRA, CAOS e ESCOLHAS MORAIS**.

**ROTEIRO DE INÍCIO (EM CHAMAS - BASEADO EM GREENEST):**
1. **O ATAQUE:** O jogo começa *in media res*. Threshold está sob ataque. O céu está vermelho. Um Dragão Azul Adulto (Lennithon) destrói as defesas com relâmpagos.
2. **OS INVASORES:** Kobolds e Cultistas (Garras de Dragão) invadem casas. Eles NÃO querem ouro, eles buscam "A Relíquia" (Dracos/Ovos).
3. **A ESCOLHA CRÍTICA:** O jogador vê duas cenas simultâneas e deve escolher IMEDIATAMENTE:
   - **Cena A:** Uma família Traladarana encurralada por Kobolds sádicos.
   - **Cena B:** A carruagem do Barão Sherlane Halaran sendo destruída pelo Meio-Dragão Langdedrosa Cyanwrath (Campeão do Culto).
4. **DEFINIÇÃO DE CLASSE & ALIANÇA:**
   - Salvar a Família = Aliança com Traladara (+1) / Inimizade com Thyatis (-1). Define classes protetoras (Paladino, Clérigo).
   - Salvar o Barão = Aliança com Thyatis (+1) / Inimizade com Traladara (-1). Define classes marciais/arcanas (Guerreiro, Mago).
   - Caçar nas Sombras = Neutro / Ordem do Grifo. Define classes furtivas (Ladino, Patrulheiro).

**PROTOCOLO DE CRIAÇÃO DE PERSONAGEM (FORMULÁRIO):**
Para ativar a ficha, envie a interface com \`modo: "formulario"\` e a estrutura exata abaixo:
\`\`\`json
"interface": {
    "modo": "formulario",
    "conteudo": {
        "titulo": "Criação de Personagem",
        "fields": [
            { "id": "nome", "type": "text", "label": "Nome", "placeholder": "Nome do Herói" },
            { "id": "raca", "type": "select", "label": "Raça", "options": ["Humano", "Anão", "Elfo", "Pequenino", "Draconato", "Gnomo", "Meio-Elfo", "Meio-Orc", "Tiefling"] },
            { "id": "classe", "type": "select", "label": "Classe", "options": ["Guerreiro", "Paladino", "Ladino", "Clérigo", "Mago", "Patrulheiro", "Bardo", "Druida", "Feiticeiro", "Bruxo", "Monge", "Bárbaro"] },
            { "id": "atributos", "type": "select", "label": "Geração de Atributos", "options": ["Padrão", "Compra de Pontos", "Rolagem"] },
            { "id": "visual_style", "type": "text", "label": "Estilo Visual", "placeholder": "Ex: Guerreiro com cicatriz, armadura gasta, pintura a óleo." }
        ]
    }
}
\`\`\`
**IMPORTANTE:** Use a descrição do "Estilo Visual" para gerar um \`update_avatar\` preciso imediatamente após o jogador enviar o formulário.

**HIERARQUIA DO CULTO (TIRANIA DOS DRAGÕES):**
Use os ranques oficiais do culto para descrever inimigos:
1. **Garras de Dragão (Dragonclaws):** Fanáticos de baixo nível, usam roupas de couro preto e máscaras simples.
2. **Asas de Dragão (Dragonwings):** Voam com capas planadoras, atacam de cima.
3. **Oradores da Wyrm (Wyrmspeakers):** Os líderes que portam as Máscaras do Dragão. Eles conseguem "sentir" onde o jogador está se ele estiver carregando um Draco.

**VILÃO INICIAL:**
**Langdedrosa Cyanwrath:** O Campeão Meio-Dragão Azul. Honrado mas brutal. Ele busca um duelo digno e persegue o jogador no início.

**SISTEMA DE CONSELHO (POLÍTICA DE GUERRA):**
Mantenha um placar político oculto em 'reputacao'.
- **Thyatis (Nobreza):** Lei e Ordem.
- **Traladara (Povo):** Tradição e Comunidade.
- **Igreja:** Fé e Pureza.
- **Grifo:** Força Militar.
- **Elfos:** Natureza e Magia.
*Regra:* Se uma facção chegar a -3, eles retiram apoio na guerra final.
*Feedback:* NPCs reagem com hostilidade (recusa de ajuda) ou gratidão baseado nisso.

**REGRAS DE OURO:**
1. **JSON OBRIGATÓRIO:** Toda resposta termina com \`--- [JSON_DATA] ---\`.
2. **SHOW, DON'T TELL:** O cheiro de ozônio, o grito do dragão, o calor do fogo. Use descrições sensoriais intensas.
3. **DADOS:** Em combate, use o sistema de DiceRoll para ataques e danos.
4. **LIMPEZA:** Não inclua tags de sistema como [DICE_ROLL_START] na narrativa. Use o objeto game_event.

**SCHEMA JSON DE RESPOSTA:**
\`\`\`json
{
  "narrative": "Texto narrativo...",
  "game_event": { "type": "none", "data": {} },
  "status_jogador": { 
      "nome": "Voron", 
      "titulo": "Sobrevivente",
      "hp_atual": 10, 
      "hp_max": 10,
      "armor_class": 10,
      "local": "Threshold (Em Chamas)",
      "missao": "Sobreviver",
      "inventario": [],
      "grupo": [],
      "reputacao": { 
          "thyatis": 0, 
          "traladara": 0,
          "igreja_karameikos": 0,
          "ordem_grifo": 0,
          "elfos_callarii": 0
      },
      "pistas_descobertas": []
  },
  "combat_state": { "round": 0, "turn_order": [] },
  "update_scene": { "trigger": false, "visual_prompt": "" },
  "update_avatar": { "trigger": false, "visual_prompt": "" },
  "interface": { "modo": "botoes", "conteudo": [] }
}
\`\`\`
`;

// Mensagem inicial com o Menu Principal contextualizado
const INITIAL_MESSAGE: Message = {
    id: 'intro',
    role: 'model',
    text: "O céu noturno sobre Threshold não é preto, é vermelho-sangue. O rugido ensurdecedor de um dragão abala os ossos do seu peito, seguido pelo som de madeira estilhaçando quando a torre do sino da igreja desmorona.\n\nVocê corre pelas ruas em pânico. Kobolds sibilantes saltam das sombras, incendiando casas com tochas. Mas eles não estão saqueando... eles estão *procurando*.\n\n— *Achem o Portador!* — ruge uma voz profunda. No centro da praça, um Meio-Dragão de dois metros de altura, vestindo armadura roxa, ergue um plebeu pelo pescoço com uma mão. — *Onde está a Caixa de Ferro?!*\n\nO caos é total. À sua esquerda, um grupo de guardas tenta proteger a entrada do Solar do Barão. À sua direita, civis fogem para o rio, perseguidos por cultistas.\n\nNo meio desse inferno, quem é você?",
    options: [
        { 
            label: "O Defensor do Povo", 
            value: "Eu me lanço para proteger os civis no rio. (Defina minha classe como Paladino ou Clérigo e inicie combate com Kobolds)" 
        },
        { 
            label: "O Soldado do Barão", 
            value: "Corro para reforçar a guarda no Solar. (Defina minha classe como Guerreiro ou Patrulheiro e inicie combate tático)" 
        },
        { 
            label: "O Oportunista Sombrio", 
            value: "Uso o caos para me esgueirar e observar o Meio-Dragão. (Defina minha classe como Ladino ou Mago e faça um teste de Furtividade)" 
        }
    ],
    gameResponse: {
        narrative: "O céu noturno...",
        status_jogador: { 
            nome: "Desconhecido", 
            titulo: "Sobrevivente", 
            hp_atual: 12, 
            hp_max: 12, 
            armor_class: 12,
            local: "Threshold (Em Chamas)", 
            missao: "Sobreviver ao Ataque do Culto", 
            inventario: ["Arma Inicial"],
            grupo: [],
            reputacao: { 
                thyatis: 0, 
                traladara: 0,
                igreja_karameikos: 0,
                ordem_grifo: 0,
                elfos_callarii: 0
            },
            pistas_descobertas: []
        },
        combat_state: {
             round: 1,
             turn_order: [
                 {name: "Herói", hp: 12, max_hp: 12, is_active: true},
                 {name: "Kobold Saqueador", hp: 5, max_hp: 5, is_active: false}
             ]
        },
        update_scene: {
            trigger: true,
            visual_prompt: "Cinematic wide shot of a medieval town at night engulfed in flames. An Adult Blue Dragon flies overhead against a blood-red sky, breathing lightning. Chaos in the streets, burning houses. Dark fantasy art style, dramatic lighting.",
            style: "Cinematic Action"
        },
        interface: { 
            modo: "botoes", 
            permitir_input_livre: true,
            conteudo: [
                { label: "O Defensor do Povo", value: "Eu me lanço para proteger..." },
                { label: "O Soldado do Barão", value: "Corro para reforçar..." },
                { label: "O Oportunista Sombrio", value: "Uso o caos..." }
            ] 
        }
    }
};

const INITIAL_BUTTONS = INITIAL_MESSAGE.options!;

// --- Helper Functions ---

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const byteLength = data.length;
  // Ensure buffer length is even for Int16Array
  if (byteLength % 2 !== 0) {
      const newData = new Uint8Array(byteLength + 1);
      newData.set(data);
      data = newData;
  }

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

const DividerDecoration = () => (
    <div className="flex items-center justify-center my-4 opacity-30">
        <div className="h-px bg-stone-500 w-1/4"></div>
        <div className="px-2 text-stone-500 font-serif">❦</div>
        <div className="h-px bg-stone-500 w-1/4"></div>
    </div>
);

// 1. Dice Result Card (Detailed Math)
// Robustness Update: Accepts 'any' to handle varied AI responses (roll_result vs d20_result)
const DiceResultCard = ({ data }: { data: any }) => {
  if (!data) return null;

  const d20 = data.d20_result || (typeof data.roll_result === 'number' ? data.roll_result : 0);
  const total = data.total_value || (typeof data.roll_result === 'number' ? data.roll_result : 0);
  const name = data.roll_name || data.reason || "Rolagem";
  const mod = data.modifier || 0;
  const prof = data.proficiency || 0;
  const isCrit = data.is_critical || false;
  const isFail = d20 === 1;
  const isSuccess = typeof data.is_success === 'boolean' ? data.is_success : (total >= (data.success_threshold || 10));
  
  let borderColor = isSuccess ? 'border-green-500/50' : 'border-red-600/50';
  let glowClass = '';
  let textColor = isSuccess ? 'text-green-400' : 'text-red-400';

  if (isCrit) {
      borderColor = 'border-amber-400';
      glowClass = 'shadow-[0_0_20px_rgba(251,191,36,0.2)] animate-pulse';
      textColor = 'text-amber-400';
  } else if (isFail) {
      borderColor = 'border-stone-600';
      glowClass = 'animate-shake grayscale';
      textColor = 'text-stone-500';
  }

  return (
    <div className={`relative w-full max-w-sm mx-auto my-4 bg-gray-900/90 backdrop-blur-sm rounded-lg border-2 ${borderColor} ${glowClass} p-4 animate-fade-in`}>
      <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
        <span className="text-stone-400 text-xs font-bold uppercase tracking-widest">{name}</span>
        {isCrit && <span className="text-amber-400 text-xs font-bold">CRÍTICO!</span>}
        {isFail && <span className="text-stone-500 text-xs font-bold">FALHA CRÍTICA</span>}
      </div>
      <div className="flex flex-col items-center">
        <div className={`w-16 h-16 flex items-center justify-center rounded-full mb-2 shadow-inner border border-white/10 ${isCrit ? 'bg-amber-900/40' : 'bg-gray-800'}`}>
          <span className={`text-3xl font-black ${isCrit ? 'text-amber-100' : 'text-white'}`}>{d20}</span>
        </div>
        <div className="flex gap-2 text-xs md:text-sm text-stone-500 font-mono mb-1">
           <span title="Dado">[{d20}]</span>
           <span title="Modificador">+ {mod}</span>
           <span title="Proficiência">+ {prof}</span>
        </div>
        <div className={`text-2xl font-bold ${textColor} drop-shadow-md`}>
          = {total}
        </div>
      </div>
    </div>
  );
};

const GameEventCard = ({ event }: { event: GameEvent }) => {
    if (!event || event.type === 'none') return null;
    if (event.type === 'dice_roll') return <DiceResultCard data={event.data as DiceRollData} />;

    let cardStyle = "border-stone-700 bg-stone-900/90";
    let icon = "✨";
    let title = "Evento";
    let mainValue = "";
    let subValue = "";

    if (event.type === 'combat_hit') {
        const data = event.data as CombatHitData;
        cardStyle = "border-red-900/60 bg-gradient-to-br from-red-950/90 to-black animate-shake";
        icon = "⚔️";
        title = "Dano Recebido";
        mainValue = `-${data.damage}`;
        subValue = `${data.damage_type} em ${data.target}`;
    } else if (event.type === 'item_obtained') {
        const data = event.data as ItemObtainedData;
        cardStyle = "border-yellow-700/50 bg-gradient-to-br from-yellow-950/40 to-black animate-fade-in";
        icon = "🎒";
        title = "Item Obtido";
        mainValue = `${data.quantity}x ${data.item_name}`;
        subValue = data.description;
    }

    return (
        <div className={`mt-4 mx-auto max-w-sm rounded-lg border-2 p-4 flex items-center justify-between shadow-xl backdrop-blur-sm ${cardStyle}`}>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1 flex items-center gap-1">
                    {icon} {title}
                </span>
                <span className="text-xs text-stone-400 font-serif italic">{subValue}</span>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-xl font-fantasy font-bold text-stone-200">{mainValue}</span>
            </div>
        </div>
    );
};

const LootToast = ({ item }: { item: ItemObtainedData }) => (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#2a2622] border-2 border-yellow-700 text-yellow-100 px-6 py-4 rounded shadow-2xl animate-fade-in-down flex items-center gap-4">
        <div className="text-4xl">{item.icon === 'potion' ? '🧪' : item.icon === 'weapon' ? '⚔️' : item.icon === 'armor' ? '🛡️' : '🎒'}</div>
        <div>
            <h4 className="font-fantasy text-lg text-yellow-500 uppercase tracking-widest">Item Obtido</h4>
            <p className="font-serif text-xl">{item.item_name}</p>
        </div>
    </div>
);

const CombatTracker = ({ combatState }: { combatState: CombatState }) => (
    <div className="bg-red-950/90 border-b-4 border-red-900 p-4 shadow-lg mb-4">
        <div className="flex justify-between items-center mb-2">
            <h3 className="text-red-300 font-fantasy text-xl uppercase tracking-widest">Combate - Turno {combatState.round}</h3>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
            {combatState.turn_order.map((combatant, idx) => (
                <div key={idx} className={`bg-black/50 p-2 rounded border min-w-[120px] ${combatant.is_active ? 'border-amber-500' : 'border-red-800/50 opacity-70'}`}>
                    <div className="font-bold text-stone-300 text-sm truncate">{combatant.name}</div>
                    <div className="w-full bg-stone-800 h-2 mt-1 rounded-full overflow-hidden">
                        <div 
                            className="bg-red-600 h-full transition-all" 
                            style={{ width: `${Math.max(0, Math.min(100, (combatant.hp / combatant.max_hp) * 100))}%` }}
                        ></div>
                    </div>
                    <div className="text-xs text-right text-stone-500 mt-0.5">{combatant.hp}/{combatant.max_hp}</div>
                </div>
            ))}
        </div>
    </div>
);

const MessageItem: React.FC<{ msg: Message, isLast: boolean }> = ({ msg, isLast }) => {
    const [isTextVisible, setIsTextVisible] = useState(true);
    const hasImage = !!msg.imageUrl;

    return (
        <div className={`mb-6 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
                className={`rounded-lg shadow-xl relative transition-all duration-500 ${
                    msg.role === 'user' 
                    ? 'bg-[#2a2622] text-[#d1c4b2] border border-[#3e352f] max-w-[90%] p-5' 
                    : `bg-[#1e1c19] text-[#e8e6e3] border border-[#3e352f] w-full ${isTextVisible ? 'max-w-4xl p-5' : 'max-w-5xl p-0 border-none bg-transparent'}`
                }`}
            >
                {/* Immersion Toggle Button */}
                {hasImage && msg.role === 'model' && (
                    <button 
                        onClick={() => setIsTextVisible(!isTextVisible)}
                        className="absolute top-2 right-2 z-20 bg-black/60 hover:bg-yellow-900/80 text-stone-300 p-2 rounded-full border border-stone-600 backdrop-blur-md transition-all"
                        title="Modo Imersivo"
                    >
                        {isTextVisible ? 
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            : 
                            <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>
                        }
                    </button>
                )}

                {msg.role === 'model' && isTextVisible && <div className="absolute top-0 left-0 w-1 h-full bg-yellow-900/50 rounded-l-lg"></div>}
                
                {msg.imageUrl && (
                    <div className={`relative group ${isTextVisible ? 'mb-4 rounded border border-[#3e352f] shadow-inner overflow-hidden' : 'rounded-xl shadow-2xl border-2 border-yellow-900/30 overflow-hidden'}`}>
                        <img 
                            src={msg.imageUrl} 
                            alt="Visualização da Cena" 
                            className={`w-full h-auto object-cover transition-all duration-700 ${isTextVisible ? 'max-h-[400px]' : 'max-h-[85vh]'}`} 
                        />
                         {/* IMMERSIVE STAT OVERLAY */}
                         {!isTextVisible && msg.gameResponse?.status_jogador?.atributos && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-6 px-6 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex justify-center gap-8 items-end">
                                <h3 className="font-fantasy text-yellow-500 text-2xl shadow-black drop-shadow-md border-r border-stone-600 pr-6">
                                    {msg.gameResponse.status_jogador.nome}
                                </h3>
                                <div className="flex gap-4">
                                    {Object.entries(msg.gameResponse.status_jogador.atributos).map(([key, val]) => (
                                        <div key={key} className="flex flex-col items-center">
                                            <span className="text-stone-500 text-[10px] uppercase font-bold tracking-widest">{key}</span>
                                            <span className="text-stone-200 font-fantasy text-xl">{val}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {isTextVisible && (
                    <div className="font-serif leading-relaxed text-lg whitespace-pre-wrap">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                        {msg.role === 'model' && msg.gameResponse?.game_event && (
                             <GameEventCard event={msg.gameResponse.game_event} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// Component for Selecting Pre-generated Characters
const PregenSelector = ({ onSelect }: { onSelect: (char: PregenCharacter) => void }) => {
    return (
        <div className="bg-[#1e1c19] border border-stone-700 p-6 rounded-lg max-w-5xl mx-auto my-6 shadow-2xl animate-fade-in">
            <h3 className="font-fantasy text-2xl text-yellow-600 mb-2 text-center tracking-widest">Lendas de Karameikos</h3>
            <p className="text-center text-stone-400 mb-6 font-serif italic">Escolha um herói pronto para iniciar sua jornada imediatamente.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {PREGEN_CHARACTERS.map((char) => (
                    <div 
                        key={char.id} 
                        onClick={() => onSelect(char)}
                        className="group relative bg-[#141210] border border-stone-600 hover:border-yellow-600 rounded-lg p-4 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl overflow-hidden flex flex-col"
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 pointer-events-none"></div>
                        <div className="absolute top-0 right-0 p-2 text-[10px] font-bold uppercase tracking-wider bg-stone-800 text-stone-300 rounded-bl-lg border-b border-l border-stone-600">
                           {char.role}
                        </div>

                        <div className="mb-3 relative z-10">
                            <h4 className="text-xl font-fantasy text-yellow-500 group-hover:text-yellow-400 transition-colors">{char.nome}</h4>
                            <span className="text-xs uppercase tracking-widest text-stone-400">{char.raca} | {char.classe}</span>
                        </div>

                        <div className="grid grid-cols-6 gap-1 mb-4 text-center relative z-10">
                            {Object.entries(char.stats).map(([stat, val]) => (
                                <div key={stat} className="bg-stone-900/80 rounded p-1 border border-stone-800">
                                    <span className="block text-[9px] uppercase font-bold text-stone-500">{stat}</span>
                                    <span className={`block font-bold ${val > 15 ? 'text-yellow-500' : 'text-stone-300'}`}>{val}</span>
                                </div>
                            ))}
                        </div>

                        <p className="text-sm text-stone-300 font-serif italic mb-4 flex-1 relative z-10 line-clamp-3">"{char.desc}"</p>

                        <div className="text-[10px] text-stone-500 relative z-10">
                            <strong className="text-stone-400">Equip:</strong> {char.equip.join(", ")}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="mt-6 text-center">
                 <button onClick={() => onSelect({ id: 'manual', nome: 'Criar Novo', raca: '', classe: '', stats: {} as any, hp: 0, equip: [], desc: '', role: '' })} className="text-stone-500 hover:text-stone-300 underline text-sm">
                     Voltar e criar ficha manualmente
                 </button>
            </div>
        </div>
    );
};


// Advanced Dynamic Form with Point Buy & Dice Logic
const DynamicForm = ({ schema, onSubmit, context }: { schema: FormSchema | any, onSubmit: (v: any) => void, context: any }) => {
    const [formData, setFormData] = useState<any>({});
    const [pointsUsed, setPointsUsed] = useState(0);

    // Robust schema normalization
    const safeFields = Array.isArray(schema) ? schema : (schema?.fields || []);
    const safeTitle = Array.isArray(schema) ? "Formulário" : (schema?.titulo || "");

    // Initialize defaults from schema if available
    useEffect(() => {
        if (safeFields.length > 0) {
            const defaults: any = {};
            safeFields.forEach((f: any) => {
                if (f.defaultValue) defaults[f.id] = f.defaultValue;
            });
            setFormData((prev: any) => ({ ...defaults, ...prev }));
        }
    }, [schema, safeFields]); 

    const STAT_IDS = ['for', 'des', 'con', 'int', 'sab', 'car'];
    
    // Auto-detect methodology based on previously selected fields or context
    const isPointBuy = formData['atributos']?.includes('Compra') || context?.method?.includes('Compra');
    const isRolling = formData['atributos']?.includes('Rolagem') || context?.method?.includes('Rolagem');

    const getPointCost = (val: number) => {
        if (val < 8) return 0;
        if (val === 8) return 0;
        if (val === 9) return 1;
        if (val === 10) return 2;
        if (val === 11) return 3;
        if (val === 12) return 4;
        if (val === 13) return 5;
        if (val === 14) return 7;
        if (val === 15) return 9;
        return 999;
    };

    useEffect(() => {
        if (isPointBuy) {
            let total = 0;
            STAT_IDS.forEach(stat => {
                const val = parseInt(formData[stat] || "8");
                if (!isNaN(val)) total += getPointCost(val);
            });
            setPointsUsed(total);
        }
    }, [formData, isPointBuy]);

    const handleInputChange = (id: string, value: string) => {
        setFormData((prev: any) => ({ ...prev, [id]: value }));
    };

    // Show error if absolutely no fields found even after normalization attempt
    if (!safeFields || safeFields.length === 0) {
         return (
            <div className="bg-red-900/30 border border-red-700 p-4 rounded-lg my-4 text-center">
                <p className="text-red-300 font-bold mb-1">Erro Arcano (Schema Vazio)</p>
                <p className="text-xs text-red-400/80 italic">O Mestre enviou um pergaminho em branco. Tente outra ação.</p>
            </div>
        );
    }

    return (
        <div className="bg-[#1e1c19] border border-stone-700 p-6 rounded-lg max-w-2xl mx-auto my-6 shadow-2xl animate-fade-in">
            {safeTitle && <h3 className="font-fantasy text-2xl text-yellow-600 mb-6 text-center tracking-widest">{safeTitle}</h3>}
            
            {/* Contextual Header for Point Buy */}
            {isPointBuy && (
                 <div className={`mb-4 p-3 border rounded-lg transition-colors ${pointsUsed > 27 ? 'bg-red-900/20 border-red-500/50' : 'bg-emerald-900/30 border-emerald-500/50'}`}>
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">Pontos Usados</span>
                        <span className={`text-xl font-bold font-mono ${pointsUsed > 27 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {pointsUsed} / 27
                        </span>
                    </div>
                    <div className="h-1.5 bg-black rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-300 ${pointsUsed > 27 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min((pointsUsed / 27) * 100, 100)}%` }}></div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                {safeFields.map((field: FormField, idx: number) => {
                    const isStat = STAT_IDS.includes(field.id);
                    
                    if (isStat && isRolling) {
                        return (
                            <div key={idx} className="flex justify-between items-center bg-black/30 p-3 rounded border border-indigo-900/30">
                                <label className="text-indigo-300 text-xs font-bold uppercase">{field.label}</label>
                                <div className="text-indigo-500 font-fantasy text-lg animate-pulse">?</div>
                            </div>
                        );
                    }

                    return (
                        <div key={idx} className="flex flex-col gap-1">
                            <label className="text-xs uppercase font-bold text-stone-500">{field.label}</label>
                            {field.type === 'select' ? (
                                <select 
                                    className="bg-black/40 border border-stone-700 text-stone-300 p-2 rounded focus:border-yellow-700 outline-none"
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                                >
                                    <option value="">Selecione...</option>
                                    {field.options?.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
                                </select>
                            ) : field.type === 'radio' ? (
                                <div className="flex flex-col gap-2">
                                    {field.options?.map((opt, i) => (
                                        <label key={i} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1 rounded">
                                            <input type="radio" name={field.id} checked={formData[field.id] === opt} onChange={() => handleInputChange(field.id, opt)} className="accent-yellow-600" />
                                            <span className="text-sm text-stone-300">{opt}</span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div className="relative">
                                    <input 
                                        type={isStat && isPointBuy ? "number" : "text"}
                                        min={isPointBuy ? "8" : undefined}
                                        max={isPointBuy ? "15" : undefined}
                                        className="w-full bg-black/40 border border-stone-700 text-stone-300 p-2 rounded focus:border-yellow-700 outline-none"
                                        value={formData[field.id] || ''}
                                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                                        placeholder={field.placeholder || ''} 
                                    />
                                    {isStat && isPointBuy && <span className="absolute right-2 top-2 text-[10px] text-stone-500">-{getPointCost(parseInt(formData[field.id] || "8"))}pts</span>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <button 
                onClick={() => onSubmit(formData)}
                disabled={isPointBuy && pointsUsed > 27}
                className={`w-full mt-8 py-3 rounded font-bold uppercase tracking-widest transition-colors ${isPointBuy && pointsUsed > 27 ? 'bg-red-900/20 text-red-500 border border-red-800 cursor-not-allowed' : 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-500 border border-yellow-800/50'}`}
            >
                {isPointBuy && pointsUsed > 27 ? "Excesso de Pontos" : "Confirmar"}
            </button>
        </div>
    );
};

const QuickActions = ({ actions, onActionClick }: { actions: string[], onActionClick: (action: string) => void }) => {
    if (!actions || actions.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mb-4 justify-center">
            {actions.map((action, idx) => (
                <button 
                    key={idx}
                    onClick={() => onActionClick(action)}
                    className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 border border-stone-700 px-3 py-1 rounded-full transition-colors"
                >
                    {action}
                </button>
            ))}
        </div>
    );
};

// --- COMPONENT: Audio Controller (Updated for Header) ---
const AudioController = ({ isPlaying, setIsPlaying, volume, setVolume, isAudioEnabled, setIsAudioEnabled }: { 
    isPlaying: boolean, 
    setIsPlaying: (v: boolean) => void, 
    volume: number,
    setVolume: (v: number) => void,
    isAudioEnabled: boolean,
    setIsAudioEnabled: (v: boolean) => void
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // URL de uma música de fantasia "Royalty Free"
  const MUSIC_URL = "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=fantasy-orchestral-adventure-109285.mp3"; 

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      if (isPlaying) {
        audioRef.current.play().catch(e => console.log("Autoplay bloqueado:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, volume]);

  return (
    <div className="flex items-center gap-3">
        <audio ref={audioRef} src={MUSIC_URL} loop />
        
        {/* Toggle Speech */}
        <button 
            onClick={() => setIsAudioEnabled(!isAudioEnabled)}
            className={`p-2 rounded-full border transition-all ${isAudioEnabled ? 'bg-yellow-900/40 border-yellow-600 text-yellow-500' : 'bg-black/40 border-stone-700 text-stone-500'}`}
            title="Narração"
        >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-5.5l6-4.5-6-4.5v9z"/></svg>
        </button>

        {/* Music Controls */}
        <div className="flex items-center gap-2 bg-[#2a2622] rounded-full px-2 py-1 border border-[#3e352f]">
            <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className={`p-1.5 rounded-full transition-all ${isPlaying ? 'text-yellow-500 animate-pulse' : 'text-stone-500'}`}
                title="Música de Fundo"
            >
                {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                )}
            </button>
            <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                value={volume} 
                onChange={(e) => setVolume(parseFloat(e.target.value))} 
                className="w-16 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-yellow-700" 
                title="Volume"
            />
        </div>
    </div>
  );
};

// --- COMPONENT: Scene Display ---
const SceneDisplay = ({ sceneData }: { sceneData?: { visual_prompt: string, style?: string, imageUrl?: string } }) => {
  if (!sceneData) return null;

  // Lógica de fallback para Unsplash se não houver imageUrl gerada
  let bgUrl = sceneData.imageUrl;
  
  if (!bgUrl) {
    bgUrl = "https://images.unsplash.com/photo-1519074069444-1ba4fff66d16?q=80&w=2544&auto=format&fit=crop"; 
    const p = sceneData.visual_prompt.toLowerCase();
    if (p.includes("tavern") || p.includes("taverna")) bgUrl = "https://images.unsplash.com/photo-1572061486716-4354228c2e68";
    if (p.includes("dungeon") || p.includes("masmorra")) bgUrl = "https://images.unsplash.com/photo-1518709268805-4e9042af9f23";
    if (p.includes("city") || p.includes("cidade") || p.includes("porto") || p.includes("harbor") || p.includes("mirros")) bgUrl = "https://images.unsplash.com/photo-1533035339906-8b226e6e6f1f";
  }

  return (
    <div className="relative w-full h-48 md:h-64 rounded-xl overflow-hidden mb-6 shadow-2xl border border-stone-800 group transition-all duration-1000">
      {/* Imagem de Fundo com key={bgUrl} para reiniciar a animação ao trocar de cenário */}
      <img key={bgUrl} src={bgUrl} alt="Cenário" className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-700 animate-fade-in" />
      
      {/* Gradiente para texto legível */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent"></div>
      
      {/* Descrição Artística (Prompt) aparecendo sutilmente */}
      <div className="absolute bottom-0 left-0 p-4 w-full">
         <p className="text-[10px] uppercase tracking-widest text-yellow-600/80 font-bold mb-1">Localização Atual</p>
         <p className="text-sm text-stone-200 font-serif italic drop-shadow-md line-clamp-2">
           {sceneData.visual_prompt}
         </p>
      </div>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
    const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
    const [isMusicPlaying, setIsMusicPlaying] = useState(false);
    
    // Atualizado para incluir imageUrl no estado do cenário
    const [currentScene, setCurrentScene] = useState<{ visual_prompt: string, style?: string, imageUrl?: string } | undefined>(
        INITIAL_MESSAGE.gameResponse?.update_scene ? { ...INITIAL_MESSAGE.gameResponse.update_scene, imageUrl: undefined } : undefined
    );
    
    // Improved Status Initialization to Hydrate from INITIAL_MESSAGE
    const [status, setStatus] = useState<GameStatus>(() => {
        // 1. Try to load from save
        const savedData = localStorage.getItem("karameikos_save_v1");
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                if (parsed.status) return parsed.status;
            } catch (e) {}
        }
        
        // 2. Default fallback to INITIAL_MESSAGE data
        const initialGameResponse = INITIAL_MESSAGE.gameResponse;
        return {
            nome: initialGameResponse?.status_jogador?.nome || "Desconhecido", 
            titulo: initialGameResponse?.status_jogador?.titulo || "Viajante", 
            hp_atual: initialGameResponse?.status_jogador?.hp_atual || 12, 
            hp_max: initialGameResponse?.status_jogador?.hp_max || 12, 
            armor_class: initialGameResponse?.status_jogador?.armor_class || 12, 
            local: initialGameResponse?.status_jogador?.local || "Threshold", 
            missao: initialGameResponse?.status_jogador?.missao || "Sobreviver", 
            inventario: initialGameResponse?.status_jogador?.inventario || [], 
            atributos: undefined,
            combat: initialGameResponse?.combat_state, // Hydrate combat state
            grupo: [],
            talentos: [],
            missoes_ativas: [],
            reputacao: initialGameResponse?.status_jogador?.reputacao || { 
                thyatis: 0, 
                traladara: 0,
                igreja_karameikos: 0,
                ordem_grifo: 0,
                elfos_callarii: 0
            }, 
            pistas_descobertas: []
        };
    });

    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [inputMode, setInputMode] = useState<"texto_livre" | "botoes" | "rolagem" | "formulario" | "selecao_fichas">("botoes");
    const [allowFreeInput, setAllowFreeInput] = useState(true); 
    const [currentOptions, setCurrentOptions] = useState<Option[]>(INITIAL_BUTTONS);
    const [currentFormSchema, setCurrentFormSchema] = useState<FormSchema | null>(null);
    const [lootNotification, setLootNotification] = useState<ItemObtainedData | null>(null);
    const [quickActions, setQuickActions] = useState<string[]>([]);
    
    // Inventory Menu State
    const [activeItemMenu, setActiveItemMenu] = useState<{ item: string, x: number, y: number } | null>(null);

    // Floating Text State (Damage/Heal numbers)
    const [floatingTexts, setFloatingTexts] = useState<{id: number, text: string, color: string}[]>([]);
    const prevHpRef = useRef(status.hp_atual);

    const [charCreationContext, setCharCreationContext] = useState<{userClass?: string, method?: string} | undefined>(undefined);

    // Audio State
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    const [volume, setVolume] = useState(0.5); 
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // --- Persistence (Save/Load) ---
    useEffect(() => {
        const savedData = localStorage.getItem("karameikos_save_v1");
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                if (parsed.messages && parsed.messages.length > 0) setMessages(parsed.messages);
                // Status is already handled in useState initializer, but this ensures updates if mounted component didn't get it
                if (parsed.status) setStatus(parsed.status);
            } catch (e) {
                console.error("Erro ao carregar save:", e);
            }
        }
    }, []);

    useEffect(() => {
        if (messages.length > 1) {
            const saveData = {
                messages,
                status,
                timestamp: Date.now()
            };
            localStorage.setItem("karameikos_save_v1", JSON.stringify(saveData));
        }
    }, [messages, status]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, inputMode, allowFreeInput]);

    // Handle Floating Damage Text Logic
    useEffect(() => {
        const diff = status.hp_atual - prevHpRef.current;
        if (diff !== 0) {
             const id = Date.now();
             const text = diff > 0 ? `+${diff}` : `${diff}`;
             const color = diff > 0 ? 'text-green-400' : 'text-red-500';
             setFloatingTexts(prev => [...prev, { id, text, color }]);
             // Remove text after animation completes
             setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 2000);
        }
        prevHpRef.current = status.hp_atual;
    }, [status.hp_atual]);

    // Initialize Audio Context on user interaction (handled in toggle)
    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume]);

    const handleResetGame = () => {
        if (window.confirm("Tens a certeza? Todo o progresso será perdido e a história reiniciada.")) {
            localStorage.removeItem("karameikos_save_v1");
            window.location.reload();
        }
    };

    const handleItemAction = (action: "usar" | "examinar" | "descartar", item: string) => {
        setActiveItemMenu(null); 
        
        let prompt = "";
        switch(action) {
            case "usar":
                prompt = `[SISTEMA: O jogador tenta USAR o item "${item}". Descreva o efeito mecânico e narrativo.]`;
                break;
            case "examinar":
                prompt = `[SISTEMA: O jogador EXAMINA detalhadamente o item "${item}".]`;
                break;
            case "descartar":
                prompt = `[SISTEMA: O jogador DESCARTA o item "${item}" no chão.]`;
                break;
        }
        handleSendMessage(prompt);
    };

    const playTTS = async (text: string) => {
        if (!isAudioEnabled) return;

        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                gainNodeRef.current = audioContextRef.current.createGain();
                gainNodeRef.current.connect(audioContextRef.current.destination);
                gainNodeRef.current.gain.value = volume;
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            setIsSpeaking(true);
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            if (!text) {
                setIsSpeaking(false);
                return;
            }

            const response = await ai.models.generateContent({
                model: TTS_MODEL_NAME,
                contents: [{ parts: [{ text: text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, 
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current && gainNodeRef.current) {
                const audioBuffer = await decodePCM(
                    decode(base64Audio),
                    audioContextRef.current,
                    24000,
                    1
                );
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(gainNodeRef.current);
                source.start();
                source.onended = () => setIsSpeaking(false);
            } else {
                setIsSpeaking(false);
            }
        } catch (error) {
            console.error("TTS Error:", error);
            setIsSpeaking(false);
        }
    };

    const handleSendMessage = async (text: string) => {
        if (!text || !text.trim()) return;

        const userMsg: Message = { id: Date.now().toString(), role: "user", text };
        setMessages(prev => [...prev, userMsg]);
        setInputText("");
        setIsLoading(true);
        setInputMode("texto_livre"); 

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const history = messages.map(m => {
               return { role: m.role, parts: [{ text: m.text }] };
            });

            history.push({ role: "user", parts: [{ text: text }] });

            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: history,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                }
            });

            const responseText = response.text || "";
            
            // --- ROBUST PARSING LOGIC ---
            let gameResponse: GameResponse | null = null;
            let narrative = responseText;

            // 1. Try strict separator
            if (responseText.includes("--- [JSON_DATA] ---")) {
                const parts = responseText.split("--- [JSON_DATA] ---");
                narrative = parts[0].trim();
                try {
                    gameResponse = JSON.parse(parts[1].trim());
                } catch(e) { console.error("Strict parse failed", e); }
            }
            // 2. Try loose separator "--- {" (Fix for user reported issue)
            else if (responseText.includes("--- {")) {
                const parts = responseText.split("--- {");
                const jsonCandidate = "{" + parts.pop();
                narrative = parts.join("--- {").trim();
                try {
                    gameResponse = JSON.parse(jsonCandidate);
                } catch(e) { console.error("Loose parse failed", e); }
            }
            // 3. Try Regex block
            else {
                const match = responseText.match(/```json([\s\S]*?)```/);
                if (match) {
                    try {
                        gameResponse = JSON.parse(match[1].trim());
                        narrative = responseText.replace(match[0], "").trim();
                    } catch(e) {}
                }
            }

            // CLEANUP
            narrative = narrative
                .replace(/\[update_scene\]:.*$/gim, "")
                .replace(/\[update_avatar\]:.*$/gim, "")
                .replace(/--- \[DICE_ROLL_START\] ---[\s\S]*?--- \[DICE_ROLL_END\] ---/g, "") // Remove leaked system text
                .replace(/---$/g, "")
                .trim();

            // --- PROCESS GAME STATE ---
            let finalOptions: Option[] = [];
            let finalForm: FormSchema | null = null;
            let nextMode: "texto_livre" | "botoes" | "rolagem" | "formulario" | "selecao_fichas" = "texto_livre";
            let nextAllowInput = false;
            let imageUrl: string | undefined = undefined;

            if (gameResponse) {
                // Status Update
                if (gameResponse.status_jogador) {
                    setStatus(prev => ({ 
                        ...prev, 
                        ...gameResponse!.status_jogador, 
                        combat: gameResponse!.combat_state 
                    }));
                } else if (gameResponse.combat_state) {
                    setStatus(prev => ({ ...prev, combat: gameResponse!.combat_state }));
                }

                // Loot Notification Trigger
                if (gameResponse.game_event?.type === 'item_obtained') {
                    setLootNotification(gameResponse.game_event.data as ItemObtainedData);
                    setTimeout(() => setLootNotification(null), 4000);
                }
                
                // Quick Actions Update
                if (gameResponse.quick_actions) {
                    setQuickActions(gameResponse.quick_actions);
                } else {
                    setQuickActions([]);
                }

                // SCENE UPDATE (Background) with AI Generation
                if (gameResponse.update_scene?.trigger) {
                    // Optimistic update using Unsplash fallback initially
                    setCurrentScene({
                        visual_prompt: gameResponse.update_scene.visual_prompt,
                        style: gameResponse.update_scene.style,
                        imageUrl: undefined 
                    });

                    // Trigger Image Generation
                    const scenePrompt = `Fantasy RPG Environment, ${gameResponse.update_scene.style || "Cinematic, Detailed"}, ${gameResponse.update_scene.visual_prompt}`;
                    
                    try {
                        ai.models.generateContent({
                            model: IMAGE_MODEL_NAME,
                            contents: [{ parts: [{ text: scenePrompt }] }]
                        }).then(sceneRes => {
                             const part = sceneRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                             if (part) {
                                 const base64Img = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                                 setCurrentScene(prev => prev ? { ...prev, imageUrl: base64Img } : undefined);
                             }
                        }).catch(e => console.error("Scene Gen Error", e));
                        
                    } catch (e) {
                        console.error("Scene Gen Init Error", e);
                    }
                }

                // Visual Update (Avatar)
                if (gameResponse.update_avatar?.trigger && gameResponse.update_avatar.visual_prompt) {
                     const avatarPrompt = "Fantasy RPG Portrait, " + gameResponse.update_avatar.visual_prompt;
                     try {
                        const avatarRes = await ai.models.generateContent({
                            model: IMAGE_MODEL_NAME,
                            contents: [{ parts: [{ text: avatarPrompt }] }]
                        });
                        const part = avatarRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                        if (part) {
                            setStatus(prev => ({ ...prev, avatarUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }));
                        }
                     } catch(e) { console.error("Avatar Gen Error", e); }
                }

                // Snapshot Image Hook (Narrative attachment) - kept for action shots if no scene update
                if (!gameResponse.update_scene?.trigger && narrative.length > 50 && Math.random() > 0.7) {
                     const scenePrompt = "Dark fantasy rpg landscape, " + narrative.substring(0, 100);
                     try {
                        const imgRes = await ai.models.generateContent({
                            model: IMAGE_MODEL_NAME,
                            contents: [{ parts: [{ text: scenePrompt }] }]
                        });
                        const part = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                        if (part) {
                            imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        }
                     } catch (e) { console.error("Scene Gen Error", e); }
                }

                // Interface Update
                if (gameResponse.interface) {
                    nextMode = gameResponse.interface.modo;
                    nextAllowInput = !!gameResponse.interface.permitir_input_livre;
                    
                    if (nextMode === 'botoes') {
                        if (Array.isArray(gameResponse.interface.conteudo) && gameResponse.interface.conteudo.length > 0) {
                            finalOptions = gameResponse.interface.conteudo as Option[];
                        } else {
                            finalOptions = [{ label: "Continuar", value: "Continuar" }];
                        }
                    } else if (nextMode === 'formulario' && gameResponse.interface.conteudo) {
                        // Assuming the content passed for form is the schema
                        finalForm = gameResponse.interface.conteudo as unknown as FormSchema;
                    }
                }
            }

            const modelMsg: Message = {
                id: Date.now().toString(),
                role: "model",
                text: narrative,
                gameResponse: gameResponse || undefined,
                options: finalOptions,
                imageUrl: imageUrl,
                form: finalForm || undefined
            };

            setMessages(prev => [...prev, modelMsg]);
            setInputMode(nextMode);
            setAllowFreeInput(nextAllowInput);
            
            playTTS(narrative);

            if (nextMode === 'botoes') {
                setCurrentOptions(finalOptions);
            } else {
                setCurrentOptions([]);
            }

            if (finalForm) setCurrentFormSchema(finalForm);

        } catch (error) {
            console.error("API Error", error);
            const errorMsg: Message = {
                id: Date.now().toString(),
                role: "model",
                text: "O tecido da realidade tremeu (Erro de API). Tente novamente."
            };
            setMessages(prev => [...prev, errorMsg]);
            setInputMode("texto_livre");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSystemAction = (text: string) => {
        handleSendMessage(text);
    };

    const handleFormSubmit = (values: Record<string, string | string[]>) => {
        if (values.classe && values.atributos) {
            setCharCreationContext({
                userClass: values.classe as string,
                method: values.atributos as string
            });
        }
        const valueString = JSON.stringify(values);
        handleSendMessage(`[SISTEMA: Ficha preenchida: ${valueString}]`);
    };

    const handlePregenSelect = (char: PregenCharacter) => {
        // Send a system message to the AI indicating the choice
        const msg = `[SISTEMA: O jogador escolheu a ficha pronta: ${char.nome}, ${char.raca}, ${char.classe}. Stats: For${char.stats.for}, Des${char.stats.des}, Con${char.stats.con}, Int${char.stats.int}, Sab${char.stats.sab}, Car${char.stats.car}. Equip: ${char.equip.join(', ')}. O jogador assumiu essa identidade. Continue a história no Passo 4.]`;
        handleSendMessage(msg);
    };
    
    const renderInputArea = () => (
        <div className="flex gap-2 max-w-4xl mx-auto w-full">
            <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSendMessage(inputText)}
                placeholder="O que você faz?"
                disabled={isLoading}
                className="flex-1 bg-stone-900 border border-stone-700 text-stone-200 p-3 rounded focus:border-yellow-700 outline-none font-serif"
            />
            <button
                onClick={() => handleSendMessage(inputText)}
                disabled={isLoading || !inputText.trim()}
                className="bg-yellow-900/30 text-yellow-600 border border-yellow-800/50 px-6 rounded font-bold hover:bg-yellow-900/50 disabled:opacity-50 transition-colors uppercase tracking-widest text-sm"
            >
                Enviar
            </button>
        </div>
    );

    return (
        <div className="h-screen w-screen flex flex-col bg-[#1a1816] text-[#d1c4b2] overflow-hidden font-sans">
            {/* TOP BAR (Header) */}
            <header className="h-16 flex-none bg-[#0e0c0a] border-b border-[#3e352f] flex items-center justify-between px-6 shadow-xl z-20">
                <div className="flex flex-col">
                    <h1 className="text-yellow-600 font-fantasy text-lg tracking-wider">Crônicas de Karameikos</h1>
                    <div className="flex items-center gap-2 text-xs text-stone-400">
                        <span className="uppercase font-bold tracking-widest">{status.local}</span>
                        {status.missao && <span className="text-stone-600">| {status.missao}</span>}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Audio Controller moved to Top Bar */}
                    <AudioController 
                        isPlaying={isMusicPlaying} 
                        setIsPlaying={setIsMusicPlaying} 
                        volume={volume}
                        setVolume={setVolume}
                        isAudioEnabled={isAudioEnabled}
                        setIsAudioEnabled={setIsAudioEnabled}
                    />
                    
                    <div className="h-6 w-px bg-stone-700 mx-2"></div>

                    <button 
                        onClick={handleResetGame} 
                        className="text-stone-500 hover:text-red-500 transition-colors text-xs uppercase tracking-widest hover:underline"
                    >
                        Reiniciar
                    </button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* FIXED LEFT SIDEBAR (Character Sheet) */}
                <aside className="hidden md:flex flex-col w-80 border-r border-[#3e352f] bg-[#141210] p-4 gap-4 overflow-y-auto z-10 shadow-xl">
                    <div className="flex flex-col items-center gap-2 mb-2 border-b border-[#2a2622] pb-4">
                        <div className="w-32 h-32 rounded-full border-2 border-yellow-900 overflow-hidden bg-black shadow-lg relative">
                            {status.avatarUrl ? (
                                <img src={status.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-4xl text-stone-700">?</div>
                            )}
                            {floatingTexts.map(ft => (
                                <div key={ft.id} className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-bold font-fantasy drop-shadow-md pointer-events-none animate-float-up ${ft.color}`} style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
                                    {ft.text}
                                </div>
                            ))}
                        </div>
                        <h2 className="font-fantasy text-xl text-yellow-600">{status.nome}</h2>
                        <span className="text-xs uppercase tracking-widest text-stone-500">{status.titulo}</span>
                    </div>

                    <div className="space-y-4">
                        {/* Stats */}
                        <div className="flex gap-2 items-end">
                            <div className="flex-1">
                                <div className="flex justify-between text-xs uppercase font-bold text-stone-500 mb-1">
                                    <span>Vitalidade</span>
                                    <span>{status.hp_atual}/{status.hp_max}</span>
                                </div>
                                <div className="h-2 bg-stone-800 rounded-full overflow-hidden border border-stone-700/50">
                                    <div 
                                        className="h-full bg-red-900 transition-all duration-500 shadow-[0_0_10px_rgba(153,27,27,0.5)]" 
                                        style={{ width: `${(status.hp_atual / status.hp_max) * 100}%`}}
                                    ></div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col items-center justify-center bg-[#2a2622] border border-stone-600 rounded px-2 py-1 min-w-[3.5rem] shadow-inner">
                                <span className="text-[9px] text-stone-500 font-bold uppercase tracking-widest mb-0.5">Defesa</span>
                                <div className="flex items-center gap-1">
                                    <svg className="w-3 h-3 text-stone-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z"/></svg>
                                    <span className="text-xl font-fantasy text-stone-200">{status.armor_class || 10}</span>
                                </div>
                            </div>
                        </div>

                        {/* Faction Reputation Display (COUNCIL SYSTEM) */}
                        {status.reputacao && (
                            <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f]">
                                <h4 className="text-xs uppercase font-bold text-stone-500 mb-2 border-b border-stone-800 pb-1">Apoio Político (Conselho)</h4>
                                <div className="flex flex-col gap-1.5 text-[10px] text-stone-300">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5"><span className="text-red-800 text-xs">🦅</span> Thyatis (Lei)</div>
                                        <span className={`font-bold ${status.reputacao.thyatis < 0 ? 'text-red-500' : 'text-yellow-600'}`}>{status.reputacao.thyatis}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5"><span className="text-stone-400 text-xs">🐺</span> Traladara (Povo)</div>
                                        <span className={`font-bold ${status.reputacao.traladara < 0 ? 'text-red-500' : 'text-yellow-600'}`}>{status.reputacao.traladara}</span>
                                    </div>
                                    {typeof status.reputacao.igreja_karameikos !== 'undefined' && (
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5"><span className="text-stone-200 text-xs">⚖️</span> Igreja (Fé)</div>
                                        <span className={`font-bold ${status.reputacao.igreja_karameikos < 0 ? 'text-red-500' : 'text-yellow-600'}`}>{status.reputacao.igreja_karameikos}</span>
                                    </div>
                                    )}
                                    {typeof status.reputacao.ordem_grifo !== 'undefined' && (
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5"><span className="text-amber-700 text-xs">🛡️</span> Ordem do Grifo</div>
                                        <span className={`font-bold ${status.reputacao.ordem_grifo < 0 ? 'text-red-500' : 'text-yellow-600'}`}>{status.reputacao.ordem_grifo}</span>
                                    </div>
                                    )}
                                    {typeof status.reputacao.elfos_callarii !== 'undefined' && (
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-1.5"><span className="text-emerald-600 text-xs">🌿</span> Elfos (Magia)</div>
                                        <span className={`font-bold ${status.reputacao.elfos_callarii < 0 ? 'text-red-500' : 'text-yellow-600'}`}>{status.reputacao.elfos_callarii}</span>
                                    </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* New Talents Section */}
                        {status.talentos && status.talentos.length > 0 && (
                            <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f]">
                                <h4 className="text-xs uppercase font-bold text-stone-500 mb-2">Talentos</h4>
                                <div className="flex flex-wrap gap-1">
                                    {status.talentos.map((t, i) => (
                                        <span key={i} className="text-[10px] bg-stone-800 text-stone-300 px-2 py-1 rounded border border-stone-700">{t}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* INVENTORY SECTION */}
                        <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f] relative">
                            <h4 className="text-xs uppercase font-bold text-stone-500 mb-2 flex justify-between">
                                <span>Mochila</span>
                                <span className="text-[10px] text-stone-600 font-normal normal-case italic">(Clique para ações)</span>
                            </h4>
                            <div className="flex flex-wrap gap-2">
                                {status.inventario?.map((item, i) => (
                                    <button 
                                        key={i} 
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setActiveItemMenu({ item, x: rect.left, y: rect.bottom + 5 });
                                        }} 
                                        className="text-xs bg-black/40 border border-stone-700 px-2 py-1 rounded text-stone-300 hover:border-yellow-700 hover:text-yellow-200 transition-all cursor-pointer flex items-center gap-1"
                                    >
                                        {item}
                                    </button>
                                ))}
                                {(!status.inventario || status.inventario.length === 0) && <span className="text-xs text-stone-600 italic">Vazio</span>}
                            </div>

                            {activeItemMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setActiveItemMenu(null)}></div>
                                    <div 
                                        className="fixed z-50 bg-[#2a2622] border border-yellow-700/50 shadow-2xl rounded-lg py-1 w-32 flex flex-col animate-fade-in text-sm"
                                        style={{ top: activeItemMenu.y, left: activeItemMenu.x }}
                                    >
                                        <div className="px-3 py-1 text-[10px] uppercase font-bold text-stone-500 border-b border-stone-700 mb-1 truncate">
                                            {activeItemMenu.item}
                                        </div>
                                        <button onClick={() => handleItemAction('usar', activeItemMenu.item)} className="text-left px-3 py-1.5 text-stone-200 hover:bg-yellow-900/40 hover:text-yellow-400 transition-colors">✨ Usar</button>
                                        <button onClick={() => handleItemAction('examinar', activeItemMenu.item)} className="text-left px-3 py-1.5 text-stone-200 hover:bg-yellow-900/40 hover:text-yellow-400 transition-colors">🔍 Examinar</button>
                                        <button onClick={() => handleItemAction('descartar', activeItemMenu.item)} className="text-left px-3 py-1.5 text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors border-t border-stone-700 mt-1">🗑️ Descartar</button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* QUESTS SECTION */}
                        <div className="mt-4 border-t border-yellow-900/30 pt-4">
                            <h4 className="text-[10px] uppercase font-bold text-stone-500 mb-3 flex items-center gap-2">
                                <span>📜 Missões</span>
                                <span className="h-[1px] flex-1 bg-stone-800"></span>
                            </h4>
                            <div className="space-y-2">
                                {status.missoes_ativas && status.missoes_ativas.length > 0 ? (
                                    status.missoes_ativas.map((quest, idx) => (
                                        <div key={quest.id || idx} className="bg-[#141210] p-2 rounded border border-stone-800">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-xs font-bold ${quest.status === 'completa' ? 'text-green-500 line-through' : quest.status === 'falha' ? 'text-red-500' : 'text-yellow-600'}`}>{quest.titulo}</span>
                                                <span className="text-[9px] uppercase tracking-wide text-stone-600">{quest.status}</span>
                                            </div>
                                            <p className="text-[10px] text-stone-400 leading-tight">{quest.descricao}</p>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-2 opacity-50">
                                        <p className="text-[10px] text-stone-600 italic">Nenhuma missão ativa.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <DividerDecoration />

                        {/* MYSTERY/CLUES SECTION - NEW */}
                        {status.pistas_descobertas && status.pistas_descobertas.length > 0 && (
                            <div className="mb-4">
                                <h4 className="text-[10px] uppercase font-bold text-stone-500 mb-3 flex items-center gap-2">
                                    <span>🔍 Pistas & Segredos</span>
                                    <span className="h-[1px] flex-1 bg-stone-800"></span>
                                </h4>
                                <ul className="space-y-2">
                                    {status.pistas_descobertas.map((pista, idx) => (
                                        <li key={idx} className="bg-[#141210] p-2 rounded border border-indigo-900/30 text-[10px] text-stone-400 leading-tight italic flex gap-2">
                                            <span className="text-indigo-500">?</span>
                                            {pista}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* GROUP / COMPANIONS SECTION */}
                        <div className="mt-4 border-t border-yellow-900/30 pt-4">
                            <h4 className="text-[10px] uppercase font-bold text-stone-500 mb-3 flex items-center gap-2">
                                <span>🛡️ Grupo</span>
                                <span className="h-[1px] flex-1 bg-stone-800"></span>
                            </h4>
                            
                            <div className="space-y-2">
                                {status.grupo && status.grupo.length > 0 ? (
                                    status.grupo.map((npc, idx) => (
                                        <div key={idx} className="flex items-center gap-3 bg-black/20 p-2 rounded border border-stone-800/50 hover:border-stone-600 transition-colors group">
                                            {/* Avatar do NPC */}
                                            <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center border border-stone-600 shadow-sm relative overflow-hidden">
                                                {npc.avatar ? (
                                                    <img src={npc.avatar} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-xs font-fantasy text-stone-300">{npc.nome.charAt(0)}</span>
                                                )}
                                                <div className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-black ${npc.status === 'Vivo' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                            </div>
                                            
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-stone-300 group-hover:text-yellow-100 transition-colors">
                                                    {npc.nome}
                                                </span>
                                                <span className="text-[9px] text-stone-500 uppercase tracking-wide">
                                                    {npc.classe}
                                                </span>
                                            </div>

                                            <button 
                                                onClick={() => handleSendMessage(`[SISTEMA: O jogador interage com ${npc.nome}.] O que você acha disso, ${npc.nome}?`)}
                                                className="ml-auto opacity-0 group-hover:opacity-100 text-stone-400 hover:text-white transition-opacity"
                                                title="Conversar"
                                            >
                                                💬
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-4 opacity-50">
                                        <p className="text-[10px] text-stone-600 italic">Você viaja sozinho... por enquanto.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Chat Area */}
                <div className="flex-1 flex flex-col relative bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
                    {lootNotification && <LootToast item={lootNotification} />}
                    {status.combat && <CombatTracker combatState={status.combat} />}

                    <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
                        {/* Scene Display (Imersive Background Banner) */}
                        {currentScene && <SceneDisplay sceneData={currentScene} />}

                        {messages.map((msg, idx) => (
                            <MessageItem 
                                key={msg.id} 
                                msg={msg} 
                                isLast={idx === messages.length - 1} 
                            />
                        ))}
                        {inputMode === 'formulario' && currentFormSchema && (
                            <DynamicForm 
                                schema={currentFormSchema} 
                                onSubmit={handleFormSubmit}
                                context={charCreationContext} 
                            />
                        )}
                        {inputMode === 'selecao_fichas' && (
                             <PregenSelector onSelect={handlePregenSelect} />
                        )}
                        {isLoading && (
                            <div className="flex justify-start animate-pulse mt-4">
                                <div className="flex items-center gap-2 bg-[#1e1c19] px-4 py-2 rounded-full border border-[#3e352f] text-stone-500 font-serif italic text-xs">
                                    <div className="w-2 h-2 bg-yellow-700 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-yellow-700 rounded-full animate-bounce delay-75"></div>
                                    <div className="w-2 h-2 bg-yellow-700 rounded-full animate-bounce delay-150"></div>
                                    O Destino está sendo escrito...
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-[#141210] border-t border-[#3e352f] shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20">
                        <QuickActions actions={quickActions} onActionClick={handleSendMessage} />
                        
                        {inputMode === 'rolagem' ? (
                            <div className="text-yellow-600 font-fantasy text-lg uppercase tracking-widest text-center py-4">
                                Rolagem Necessária
                            </div>
                        ) : inputMode === 'botoes' ? (
                            <div className="flex flex-col gap-4 w-full">
                                <div className="flex flex-wrap gap-2 justify-center animate-fade-in">
                                    {currentOptions.map((opt, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSendMessage(opt.value)}
                                            className="group relative bg-stone-800 hover:bg-[#2a2622] border border-stone-600 hover:border-yellow-700 px-5 py-3 rounded text-left flex flex-col min-w-[200px] transition-all hover:-translate-y-1 shadow-lg overflow-hidden"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-900/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                            <span className="text-yellow-500 font-bold text-sm font-fantasy tracking-wide relative z-10">{opt.label}</span>
                                            {opt.sub && <span className="text-stone-500 text-xs italic relative z-10">{opt.sub}</span>}
                                        </button>
                                    ))}
                                </div>
                                {allowFreeInput && renderInputArea()}
                            </div>
                        ) : inputMode === 'formulario' ? (
                            <div className="text-center text-stone-500 text-xs uppercase tracking-widest py-3 opacity-60">
                                Preencha o pergaminho acima
                            </div>
                         ) : inputMode === 'selecao_fichas' ? (
                            <div className="text-center text-stone-500 text-xs uppercase tracking-widest py-3 opacity-60">
                                Escolha seu destino acima
                            </div>
                        ) : (
                            renderInputArea()
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Mount the App
const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);