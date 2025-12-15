import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Modality } from "@google/genai";
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
  defaultValue?: string; 
  options?: string[];
  max_select?: number; 
}

interface FormSchema {
  titulo: string;
  fields: FormField[];
}

interface RollRequest {
  dado: string;
  motivo: string;
  dificuldade_oculta?: number;
}

interface Combatant {
  name: string;
  hp: number;
  max_hp: number;
  is_active: boolean;
  avatar?: string;
}

interface CombatState {
  round: number;
  turn_order: Combatant[];
}

interface InterfaceData {
  modo: "rolagem" | "botoes" | "formulario" | "texto_livre";
  permitir_input_livre?: boolean; 
  pedir_rolagem?: RollRequest;
  conteudo?: Option[] | FormSchema; 
}

// --- NEW: Strict Game Engine Event Structure ---
interface DiceRollData {
  roll_name: string;
  d20_result: number;
  modifier: number;
  proficiency: number;
  total_value: number;
  is_critical: boolean;
  is_success: boolean;
}

interface CombatHitData {
  target: string;
  damage: number;
  damage_type: string;
  is_critical: boolean;
}

interface ItemObtainedData {
  item_name: string;
  quantity: number;
  description: string;
  rarity?: "common" | "uncommon" | "rare" | "legendary";
  icon?: "weapon" | "potion" | "armor" | "misc";
}

interface GameEvent {
  type: "none" | "dice_roll" | "combat_hit" | "item_obtained";
  data: DiceRollData | CombatHitData | ItemObtainedData | any;
}

// The Root JSON Response from the AI
interface GameResponse {
  narrative: string;
  game_event?: GameEvent;
  status_jogador?: {
    nome: string;
    titulo: string;
    hp_atual: number;
    hp_max: number;
    armor_class?: number; // Added Armor Class
    local: string;
    missao?: string;
    inventario?: string[];
    atributos?: Record<string, string>; 
  };
  combat_state?: CombatState; // Added combat state
  quick_actions?: string[]; // Added quick actions
  update_avatar?: {
    trigger: boolean;
    visual_prompt?: string;
    style?: string;
  };
  interface?: InterfaceData;
  form?: FormSchema; // Optional shorthand for interface.conteudo if mode is form
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  imageUrl?: string;
  gameResponse?: GameResponse; // Store the full parsed response
  options?: Option[];
  form?: FormSchema;
}

interface GameStatus {
  nome: string;
  titulo: string;
  hp_atual: number;
  hp_max: number;
  armor_class?: number; // Added Armor Class
  local: string;
  missao: string;
  avatarUrl?: string;
  inventario?: string[];
  atributos?: Record<string, string>; 
  combat?: CombatState;
}

// --- Constants & Config ---
const MODEL_NAME = "gemini-2.5-flash";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";

const CLASS_GUIDE: Record<string, { main: string[], desc: string, optimal: Record<string, string> }> = {
    "guerreiro": {
        main: ["for"],
        desc: "Prioridade para dano corpo a corpo.",
        optimal: { for: "15", con: "14", des: "13", sab: "12", car: "10", int: "8" }
    },
    "ladino": {
        main: ["des"],
        desc: "Essencial para furtividade e ataque.",
        optimal: { des: "15", int: "14", con: "13", car: "12", sab: "10", for: "8" }
    },
    "mago": {
        main: ["int"],
        desc: "Essencial para lançar magias.",
        optimal: { int: "15", con: "14", des: "13", sab: "12", car: "10", for: "8" }
    },
    "clérigo": {
        main: ["sab"],
        desc: "Poder divino e magias.",
        optimal: { sab: "15", con: "14", for: "13", car: "12", int: "10", des: "8" }
    },
     "patrulheiro": {
        main: ["des", "sab"],
        desc: "Combate ágil e magias naturais.",
        optimal: { des: "15", sab: "14", con: "13", for: "12", int: "10", car: "8" }
    }
};

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é um Motor de Jogo (Game Engine) e Mestre de RPG narrando Karameikos (D&D 5e).
Seu objetivo é gerar uma experiência imersiva e visual, separando estritamente a NARRATIVA da MECÂNICA.

**REGRA DE OURO (OUTPUT JSON):**
Você deve SEMPRE responder com um objeto JSON válido. NUNCA envie texto solto fora do JSON.

**ESTRUTURA OBRIGATÓRIA DO JSON:**
\`\`\`json
{
  "narrative": "A descrição literária da cena, diálogos e ambiente. Use Markdown para formatar (negrito, itálico).",
  
  "game_event": {
    "type": "none" | "dice_roll" | "combat_hit" | "item_obtained",
    "data": {
      // SE type="dice_roll":
      "roll_name": "Nome do Teste (ex: Furtividade)",
      "d20_result": 15,    // Valor cru do dado
      "modifier": 3,       // Modificador de atributo
      "proficiency": 2,    // Bônus de proficiência (se aplicável, ou 0)
      "total_value": 20,   // Soma final
      "is_critical": false, // True se d20_result == 20
      "is_success": true   // Baseado na DC oculta
      
      // SE type="combat_hit":
      // "target": "Goblin", "damage": 5, "damage_type": "Cortante", "is_critical": false
      
      // SE type="item_obtained":
      // "item_name": "Espada Curta", "quantity": 1, "description": "Lâmina enferrujada.", "rarity": "common", "icon": "weapon"
      // rarity options: common, uncommon, rare, legendary
      // icon options: weapon, potion, armor, misc
    }
  },

  "status_jogador": { 
      "nome": "Voron", 
      "titulo": "Guerreiro Nível 1",
      "hp_atual": 10, 
      "hp_max": 10,
      "armor_class": 16,
      "local": "Estrada de Threshold",
      "missao": "Sobreviver",
      "inventario": ["Corda", "Tocha"],
      "atributos": { "for": "15", "des": "12", ... } 
  },

  "combat_state": { // Opcional, envie APENAS se houver combate ativo
      "round": 1,
      "turn_order": [
          {"name": "Voron", "hp": 10, "max_hp": 10, "is_active": true, "avatar": ""},
          {"name": "Goblin", "hp": 7, "max_hp": 7, "is_active": false}
      ]
  },
  
  "quick_actions": ["Olhar ao redor", "Checar inventário", "Falar com NPC"], // NEW: 3-5 ações curtas contextuais

  "update_avatar": {
      "trigger": false, 
      "visual_prompt": "Descrição VISUAL focada em UM ÚNICO personagem (se for retrato). Ex: 'Solo portrait of a grim human warrior, detailed face, dark fantasy oil painting style'. NÃO descreva grupos a menos que explicitamente solicitado.", 
      "style": "Dark Fantasy RPG Art, Solo Character Portrait, Oil Painting style"
  },

  "interface": {
      "modo": "botoes" | "formulario" | "texto_livre" | "rolagem",
      "permitir_input_livre": true,
      "conteudo": [ // Se modo="botoes"
          {"label": "Atacar", "value": "Eu ataco com minha espada", "sub": "Ação Padrão"},
          {"label": "Fugir", "value": "Tento fugir para a floresta"}
      ],
      // Se modo="formulario", preencher "conteudo" com o schema do formulário
  }
}
\`\`\`

**DIRETRIZES DE MESTRAGEM:**
1. **Juice & Feel**: Quando o jogador fizer uma ação que exija teste, GERE o teste você mesmo e retorne o resultado em \`game_event\`. Não peça para o jogador rolar se você pode simular a rolagem para dar agilidade.
2. **Matemática Transparente**: Em \`dice_roll\`, preencha os campos \`d20_result\`, \`modifier\` e \`proficiency\` corretamente.
3. **Criação de Personagem**: No início, use \`interface.modo = "formulario"\`.
4. **Atributos**: Se o jogador escolher 'Rolagem', GERE os valores (4d6 drop lowest), ALOQUE-OS otimizadamente para a classe escolhida e NARRE o resultado. Se escolher 'Padrão' ou 'Compra', respeite os valores enviados.
`;

const INITIAL_BUTTONS: Option[] = [
  { label: "Legionário Thyatiano", sub: "Guerreiro Humano", value: "Eu sou um Legionário Thyatiano (Guerreiro Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "\"Raposa\" Traladarana", sub: "Ladino Humano", value: "Eu sou uma 'Raposa' Traladarana (Ladino Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "Erudito de Glantri", sub: "Mago Elfo", value: "Eu sou um Erudito de Glantri (Mago Elfo). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "✨ Criar meu próprio", sub: "Personalizado", value: "Gostaria de criar meu próprio personagem. (SISTEMA: Responda IMEDIATAMENTE com interface.modo='formulario' usando o SCHEMA OBRIGATÓRIO de criação de ficha)." },
];

const INITIAL_MESSAGE: Message = {
    id: 'intro',
    role: 'model',
    text: "Bem-vindo a Karameikos. A névoa cobre as montanhas escarpadas ao norte, enquanto as tensões entre os nativos Traladaranos e os conquistadores Thyatianos fervem nas cidades. Você se encontra na estrada perto de Threshold. O vento uiva, carregando o cheiro de chuva e... algo mais metálico.\n\nAntes de começarmos, quem é você?",
    options: INITIAL_BUTTONS,
    gameResponse: {
        narrative: "Bem-vindo a Karameikos...",
        status_jogador: { nome: "Desconhecido", titulo: "Aventureiro", hp_atual: 10, hp_max: 10, armor_class: 10, local: "Estrada de Threshold", missao: "Sobreviver", inventario: [] },
        interface: { modo: "botoes", permitir_input_livre: true, conteudo: INITIAL_BUTTONS }
    }
}

// --- Components ---

const CornerDecoration = ({ className }: { className: string }) => (
  <svg viewBox="0 0 50 50" className={`w-8 h-8 text-yellow-700/60 absolute ${className}`} fill="currentColor">
    <path d="M0,0 v15 q5,0 10,5 t5,10 h15 v-30 z" />
    <path d="M5,5 l15,15" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const DividerDecoration = () => (
  <div className="flex items-center justify-center gap-2 my-4 opacity-70">
     <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-yellow-700"></div>
     <svg viewBox="0 0 24 24" className="w-5 h-5 text-yellow-600" fill="currentColor">
        <path d="M12 2L14.5 10H9.5L12 2Z" />
        <path d="M12 22L9.5 14H14.5L12 22Z" />
        <circle cx="12" cy="12" r="2" />
     </svg>
     <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-yellow-700"></div>
  </div>
);

// --- VISUAL CARDS (UI/UX) ---

// 1. Dice Result Card (Detailed Math)
const DiceResultCard = ({ data }: { data: DiceRollData }) => {
  if (!data) return null;

  const isCrit = data.is_critical;
  const isFail = data.d20_result === 1;
  
  let borderColor = data.is_success ? 'border-green-500/50' : 'border-red-600/50';
  let glowClass = '';
  let textColor = data.is_success ? 'text-green-400' : 'text-red-400';

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
      {/* Header */}
      <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
        <span className="text-stone-400 text-xs font-bold uppercase tracking-widest">{data.roll_name}</span>
        {isCrit && <span className="text-amber-400 text-xs font-bold">CRÍTICO!</span>}
        {isFail && <span className="text-stone-500 text-xs font-bold">FALHA CRÍTICA</span>}
      </div>

      <div className="flex flex-col items-center">
        {/* Visual Dice */}
        <div className={`w-16 h-16 flex items-center justify-center rounded-full mb-2 shadow-inner border border-white/10 ${isCrit ? 'bg-amber-900/40' : 'bg-gray-800'}`}>
          <span className={`text-3xl font-black ${isCrit ? 'text-amber-100' : 'text-white'}`}>{data.d20_result}</span>
        </div>
        
        {/* Transparent Math */}
        <div className="flex gap-2 text-xs md:text-sm text-stone-500 font-mono mb-1">
           <span title="Dado">[{data.d20_result}]</span>
           <span title="Modificador">+ {data.modifier}</span>
           <span title="Proficiência">+ {data.proficiency}</span>
        </div>

        {/* Total */}
        <div className={`text-2xl font-bold ${textColor} drop-shadow-md`}>
          = {data.total_value}
        </div>
      </div>
    </div>
  );
};

// 2. Generic Event Card (Items, Damage, etc)
const GameEventCard = ({ event }: { event: GameEvent }) => {
    if (!event || event.type === 'none') return null;

    if (event.type === 'dice_roll') {
        return <DiceResultCard data={event.data as DiceRollData} />;
    }

    // Styles for other events
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
                <span className="text-xs text-stone-400 font-serif italic">
                    {subValue}
                </span>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-xl font-fantasy font-bold text-stone-200">
                    {mainValue}
                </span>
            </div>
        </div>
    );
};

// 3. Combat Tracker Component
const CombatTracker = ({ combatState }: { combatState: CombatState }) => {
  if (!combatState || !combatState.turn_order) return null;

  return (
    <div className="w-full bg-black/80 backdrop-blur-md border-b border-yellow-900/30 p-3 flex gap-4 overflow-x-auto items-center animate-fade-in">
      <span className="text-xs font-bold text-red-500 uppercase tracking-widest whitespace-nowrap mr-2">
        Turno {combatState.round}
      </span>
      
      {combatState.turn_order.map((char, idx) => (
        <div 
          key={idx}
          className={`
            relative flex flex-col items-center min-w-[60px] transition-all duration-300
            ${char.is_active ? 'scale-110 opacity-100' : 'opacity-60 grayscale'}
          `}
        >
          {/* Avatar com Borda de Destaque se for o Turno Ativo */}
          <div className={`w-10 h-10 rounded-full border-2 overflow-hidden ${char.is_active ? 'border-amber-500 shadow-[0_0_10px_#f59e0b]' : 'border-gray-600'}`}>
             {char.avatar ? (
                <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
             ) : (
                <div className="w-full h-full bg-stone-800 flex items-center justify-center text-[8px]">{char.name.substring(0,2)}</div>
             )}
          </div>
          
          {/* Barra de Vida Miniatura */}
          <div className="w-full h-1.5 bg-gray-700 mt-1 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${char.hp < char.max_hp * 0.3 ? 'bg-red-500' : 'bg-green-500'}`} 
              style={{ width: `${Math.max(0, Math.min(100, (char.hp / char.max_hp) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// 4. Loot Toast Component (Notification)
const LootToast = ({ item }: { item: ItemObtainedData }) => {
  if (!item) return null;

  const colors: Record<string, string> = {
    common: "border-gray-500 shadow-gray-500/10",
    uncommon: "border-green-500 shadow-green-500/20",
    rare: "border-blue-500 shadow-blue-500/20",
    legendary: "border-amber-500 shadow-amber-500/40"
  };

  const theme = colors[item.rarity || 'common'] || colors.common;

  // Simple icon mapping logic
  const getIcon = () => {
    if (item.icon) {
        switch(item.icon) {
            case 'potion': return '🧪';
            case 'weapon': return '⚔️';
            case 'armor': return '🛡️';
            case 'misc': return '🎒';
        }
    }
    // Fallback based on name keywords if no icon provided
    const name = item.item_name.toLowerCase();
    if (name.includes('poção') || name.includes('elixir')) return '🧪';
    if (name.includes('espada') || name.includes('machado') || name.includes('arco')) return '⚔️';
    if (name.includes('armadura') || name.includes('escudo') || name.includes('manto')) return '🛡️';
    return '🎒';
  };

  return (
    <div className={`
      absolute top-20 right-4 z-50 flex items-center gap-3 p-3 rounded-lg 
      bg-gray-900/90 border-l-4 ${theme} shadow-lg backdrop-blur-sm
      animate-in slide-in-from-right duration-500
    `}>
      <div className="w-10 h-10 bg-black/40 rounded flex items-center justify-center text-2xl">
        {getIcon()}
      </div>
      
      <div>
        <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Item Obtido</p>
        <p className="font-bold text-white text-sm">{item.item_name}</p>
      </div>
    </div>
  );
};

// 5. Quick Actions Component
const QuickActions = ({ actions, onActionClick }: { actions: string[], onActionClick: (action: string) => void }) => {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex gap-2 mb-2 px-1 overflow-x-auto pb-2 w-full">
      {actions.map((actionText, idx) => (
        <button
          key={idx}
          onClick={() => onActionClick(actionText)}
          className="
            whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium
            bg-stone-800 text-stone-300 border border-stone-600
            hover:bg-stone-700 hover:text-white hover:border-yellow-600
            transition-all active:scale-95 shadow-sm
          "
        >
          {actionText}
        </button>
      ))}
    </div>
  );
};

// --- Audio Utils ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Manual PCM Decoder to fix TTS audio error
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

// --- Fallback Schema (Security) ---
const DEFAULT_CHAR_SHEET: FormSchema = {
    titulo: "Registro de Aventureiro",
    fields: [
        { 
            id: "nome", 
            type: "text", 
            label: "Nome do Herói", 
            placeholder: "Ex: Voron, o Astuto" 
        },
        { 
            id: "classe", 
            type: "select", 
            label: "Vocação (Classe)", 
            options: ["Guerreiro (Soldado)", "Ladino (Criminoso)", "Mago (Erudito)", "Clérigo (Acólito)", "Patrulheiro (Caçador)"] 
        },
        { 
            id: "origem", 
            type: "radio", 
            label: "Origem Regional", 
            options: ["Nativo de Karameikos", "Invasor Thyatiano", "Elfo de Alfheim", "Anão de Rockhome"] 
        },
        { 
            id: "atributos", 
            type: "select", 
            label: "Método de Atributos", 
            options: ["Arranjo Padrão (15, 14, 13, 12, 10, 8)", "Rolagem de Dados (4d6 drop lowest)", "Compra de Pontos (27 pts)"] 
        },
        // Explicitly adding attribute fields for DynamicForm logic
        { id: "for", type: "text", label: "Força", placeholder: "0" },
        { id: "des", type: "text", label: "Destreza", placeholder: "0" },
        { id: "con", type: "text", label: "Constituição", placeholder: "0" },
        { id: "int", type: "text", label: "Inteligência", placeholder: "0" },
        { id: "sab", type: "text", label: "Sabedoria", placeholder: "0" },
        { id: "car", type: "text", label: "Carisma", placeholder: "0" },
    ]
};

// --- Dynamic Form Component ---
const DynamicForm = ({ 
    schema, 
    onSubmit,
    context 
}: { 
    schema: any, 
    onSubmit: (values: Record<string, string | string[]>) => void,
    context?: { userClass?: string, method?: string }
}) => {
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pointsUsed, setPointsUsed] = useState(0);

    let activeSchema = schema || {};
    const fields = Array.isArray(activeSchema.fields) ? activeSchema.fields : [];
    const hasGenericFields = fields.some((f: any) => f.label?.toLowerCase().includes("campo") || f.label?.toLowerCase().includes("field"));
    const isEmpty = fields.length === 0;

    if (isEmpty || hasGenericFields) {
        activeSchema = DEFAULT_CHAR_SHEET;
    }
    
    const safeFields = activeSchema.fields;
    const isAttributeAllocation = activeSchema.titulo?.toLowerCase().includes("alocação") || 
                                  activeSchema.titulo?.toLowerCase().includes("atributos") ||
                                  activeSchema.titulo === "Registro de Aventureiro";

    // Logic to detect method
    const attributeMethod = formData['atributos'] ? formData['atributos'].toString() : "";
    const isRolling = attributeMethod.toLowerCase().includes('rolagem');
    const isPointBuy = attributeMethod.toLowerCase().includes('compra');
    const isStandard = attributeMethod.toLowerCase().includes('padrão');

    const STAT_IDS = ['for', 'des', 'con', 'int', 'sab', 'car'];

    // Point Buy Calculation Helper
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
        return 999; // Invalid for 5e point buy
    };

    useEffect(() => {
        const defaults: Record<string, any> = {};
        safeFields.forEach((field: any) => {
            if (field.defaultValue) {
                defaults[field.id] = field.defaultValue;
            }
        });
        if (Object.keys(defaults).length > 0) {
            setFormData(prev => ({ ...defaults, ...prev }));
        }
    }, [activeSchema]);

    // Recalculate Points when formData changes
    useEffect(() => {
        if (isPointBuy) {
            let total = 0;
            STAT_IDS.forEach(stat => {
                const val = parseInt(formData[stat] || "8");
                if (!isNaN(val)) {
                    total += getPointCost(val);
                }
            });
            setPointsUsed(total);
        }
    }, [formData, isPointBuy]);

    const handleInputChange = (id: string, value: string) => {
        // Enforce numeric limits for stats if in Point Buy or Standard
        if (STAT_IDS.includes(id) && (isPointBuy || isStandard)) {
             // Allow empty for typing
             if (value === "") {
                 setFormData(prev => ({ ...prev, [id]: value }));
                 return;
             }
             const num = parseInt(value);
             if (isNaN(num)) return;
             if (isPointBuy && (num < 8 || num > 15)) {
                 // Soft limit visual feedback could be improved, but strict clamping here for simplicity
                 // Or better, let them type but show error visually. Let's just update for now.
             }
        }
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleCheckboxChange = (id: string, option: string, max: number) => {
        setFormData(prev => {
            const current = prev[id] || [];
            if (current.includes(option)) {
                return { ...prev, [id]: current.filter((item: string) => item !== option) };
            } else {
                if (max && current.length >= max) return prev;
                return { ...prev, [id]: [...current, option] };
            }
        });
    };

    const getAttributeConfig = (fieldId: string) => {
        if (!isAttributeAllocation || !formData.classe) return { placeholder: undefined, isMain: false };
        
        const classKey = Object.keys(CLASS_GUIDE).find(k => 
            formData.classe.toLowerCase().includes(k)
        );
        
        if (!classKey) return { placeholder: "Valor...", isMain: false };
        
        const guide = CLASS_GUIDE[classKey];
        const isMain = guide.main.includes(fieldId);

        let placeholder = "8";

        if (isStandard) {
            placeholder = `Sug: ${guide.optimal[fieldId] || "8"}`;
        } else if (isRolling) {
            placeholder = "";
        } else if (isPointBuy) {
            placeholder = "8";
        } else {
            if (isMain) {
                placeholder = "⭐ Principal";
            }
        }

        return { placeholder, isMain };
    };

    return (
        <div className="mt-8 mx-auto max-w-lg relative group animate-fade-in">
             <div className="absolute -inset-0.5 bg-gradient-to-b from-yellow-800 to-yellow-950 rounded-lg opacity-50 blur-[2px]"></div>
             
             <div className="relative bg-[#1a1816] border border-yellow-900/60 p-6 rounded-lg shadow-2xl">
                 <div className="mb-6 text-center border-b border-yellow-900/30 pb-4">
                     <h3 className="text-yellow-600 font-fantasy text-xl tracking-[0.2em] uppercase drop-shadow-md">
                        {activeSchema.titulo || "Ficha de Personagem"}
                     </h3>
                 </div>

                 {isAttributeAllocation && (
                     <div className="mb-6">
                        {isStandard && (
                             <div className="p-4 bg-stone-900/50 border border-stone-700 rounded-lg text-center animate-fade-in">
                                <span className="text-[10px] text-stone-500 uppercase tracking-[0.2em] block mb-2 font-bold">
                                    Banco de Valores (Arranjo Padrão)
                                </span>
                                <div className="flex justify-center gap-2 font-fantasy text-lg text-yellow-500">
                                    {[15, 14, 13, 12, 10, 8].map(n => (
                                        <span key={n} className="bg-black/40 px-2 rounded border border-yellow-900/30">{n}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {isRolling && (
                             <div className="p-4 bg-indigo-900/30 border border-indigo-500/50 rounded-lg text-center animate-pulse flex flex-col items-center">
                                <div className="text-3xl mb-2">🎲</div>
                                <span className="text-xs text-indigo-300 uppercase tracking-widest font-bold block mb-1">
                                    O Mestre Rola os Dados
                                </span>
                                <p className="text-xs text-indigo-200/80 font-serif italic">
                                    Ao confirmar, a IA rolará 4d6 (descarta o menor) para cada atributo.
                                </p>
                            </div>
                        )}
                        {isPointBuy && (
                            <div className="flex flex-col gap-3">
                                <div className={`p-3 border rounded-lg transition-colors ${pointsUsed > 27 ? 'bg-red-900/20 border-red-500/50' : 'bg-emerald-900/30 border-emerald-500/50'}`}>
                                     <div className="flex justify-between items-end mb-1">
                                        <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400">Pontos Usados</span>
                                        <span className={`text-xl font-bold font-mono ${pointsUsed > 27 ? 'text-red-400' : 'text-emerald-400'}`}>
                                            {pointsUsed} / 27
                                        </span>
                                     </div>
                                     <div className="h-1.5 bg-black rounded-full overflow-hidden">
                                         <div 
                                            className={`h-full transition-all duration-300 ${pointsUsed > 27 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                                            style={{ width: `${Math.min((pointsUsed / 27) * 100, 100)}%` }}
                                         ></div>
                                     </div>
                                </div>
                                
                                <div className="grid grid-cols-8 gap-1 text-center">
                                     {[[8,0],[9,1],[10,2],[11,3],[12,4],[13,5],[14,7],[15,9]].map(([val, cost]) => (
                                         <div key={val} className="flex flex-col bg-black/40 rounded border border-emerald-500/10 p-1 text-[8px] md:text-[10px]">
                                             <span className="text-stone-300 font-bold">{val}</span>
                                             <span className="text-emerald-500/80">{cost}pt</span>
                                         </div>
                                     ))}
                                </div>
                            </div>
                        )}
                     </div>
                 )}

                 <form onSubmit={(e) => { e.preventDefault(); setIsSubmitting(true); onSubmit(formData); }} className="space-y-4">
                    {safeFields.map((field: any, idx: number) => {
                        const isStat = STAT_IDS.includes(field.id);
                        const { placeholder: smartPlaceholder, isMain } = getAttributeConfig(field.id);
                        
                        // --- Custom Render for Rolagem (Visual Slots instead of inputs) ---
                        if (isStat && isRolling) {
                            return (
                                <div key={field.id} className="md:col-span-1 bg-black/30 border border-indigo-900/30 rounded p-3 flex justify-between items-center opacity-70">
                                    <label className="text-indigo-300 text-xs font-bold uppercase tracking-widest">
                                        {field.label} {isMain && <span className="text-[9px] text-amber-500 ml-1">★</span>}
                                    </label>
                                    <div className="text-indigo-500 font-fantasy text-lg animate-pulse">?</div>
                                </div>
                            );
                        }

                        // Standard Input Logic
                        let inputStyle = `bg-black/30 border rounded p-3 text-stone-200 outline-none font-serif w-full placeholder-stone-600 focus:placeholder-stone-500/50 
                            ${isMain ? 'border-amber-500 ring-1 ring-amber-500/50 bg-amber-900/10' : 'border-stone-700 focus:border-yellow-700'}`;
                        
                        if (isStat && isPointBuy) {
                            const val = parseInt(formData[field.id] || "8");
                            const invalid = val < 8 || val > 15;
                            if (invalid) inputStyle = inputStyle.replace('border-stone-700', 'border-red-500 text-red-200');
                        }

                        return (
                        <div key={field.id || idx} className={`flex flex-col gap-1 ${isStat ? 'md:col-span-1' : 'col-span-2'}`}>
                            <label className="text-stone-400 text-xs font-bold uppercase tracking-widest flex justify-between items-center">
                                <span className={isMain ? "text-amber-500" : ""}>{field.label}</span>
                                {isMain && <span className="text-[9px] text-amber-600">★</span>}
                                {field.max_select && <span className="text-[9px] text-stone-600">(Max: {field.max_select})</span>}
                            </label>
                            
                            {field.type === 'text' && (
                                <div className="relative">
                                    <input 
                                        type={isStat && (isPointBuy || isStandard) ? "number" : "text"}
                                        min={isPointBuy ? "8" : undefined}
                                        max={isPointBuy ? "15" : undefined}
                                        placeholder={smartPlaceholder || field.placeholder}
                                        value={formData[field.id] || ''}
                                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                                        className={inputStyle}
                                    />
                                    {isStat && isPointBuy && (
                                        <div className="absolute right-2 top-3 text-[10px] text-stone-500 pointer-events-none font-mono">
                                            -{getPointCost(parseInt(formData[field.id] || "8"))}pts
                                        </div>
                                    )}
                                </div>
                            )}

                            {field.type === 'select' && (
                                 <div className="relative">
                                     <select
                                        value={formData[field.id] || ''}
                                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                                        className="w-full bg-black/30 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif appearance-none cursor-pointer"
                                     >
                                        <option value="">Selecione...</option>
                                        {(field.options || []).map((opt: string, i: number) => (
                                            <option key={i} value={opt}>{opt}</option>
                                        ))}
                                     </select>
                                     <div className="absolute right-3 top-3.5 text-stone-500 pointer-events-none text-xs">▼</div>
                                </div>
                            )}

                            {(field.type === 'radio' || field.type === 'checkbox') && (
                                <div className="flex flex-col gap-2 bg-black/20 p-2 rounded border border-stone-800/50">
                                    {(field.options || []).map((opt: string, i: number) => {
                                        const isSelected = field.type === 'radio' ? formData[field.id] === opt : (formData[field.id] || []).includes(opt);
                                        return (
                                            <label key={i} className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 rounded transition-colors">
                                                <div className={`w-3 h-3 rounded flex items-center justify-center ${isSelected ? 'bg-yellow-800 border-yellow-600' : 'border border-stone-600'}`}>
                                                    {isSelected && <div className="w-1.5 h-1.5 bg-yellow-200 rounded-full"></div>}
                                                </div>
                                                {field.type === 'radio' ? (
                                                    <input type="radio" name={field.id} checked={isSelected} onChange={() => handleInputChange(field.id, opt)} className="hidden" />
                                                ) : (
                                                    <input type="checkbox" checked={isSelected} onChange={() => handleCheckboxChange(field.id, opt, field.max_select)} className="hidden" />
                                                )}
                                                <span className={`text-sm ${isSelected ? 'text-yellow-100' : 'text-stone-400'}`}>{opt}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );})}

                    <button 
                        type="submit"
                        disabled={isSubmitting || (isPointBuy && pointsUsed > 27)}
                        className={`
                            w-full mt-6 font-bold py-3 rounded uppercase tracking-widest shadow-lg transition-all border
                            ${(isPointBuy && pointsUsed > 27) 
                                ? 'bg-red-900/20 border-red-800 text-red-500 cursor-not-allowed opacity-50'
                                : 'bg-gradient-to-r from-yellow-900 to-yellow-800 hover:from-yellow-800 hover:to-yellow-700 text-stone-200 border-yellow-700/50'}
                        `}
                    >
                        {isSubmitting ? "Gravando..." : (isPointBuy && pointsUsed > 27 ? `Excesso de Pontos (${pointsUsed-27})` : "Confirmar Destino")}
                    </button>
                 </form>
             </div>
        </div>
    );
}

// --- Main App Component ---

const App = () => {