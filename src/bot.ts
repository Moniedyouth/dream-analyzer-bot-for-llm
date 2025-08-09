import {Scenes, session, Telegraf} from 'telegraf';
import logProcessTimeMiddleware from "./middlewares/log-process-time.middleware";
import checkChatTypeMiddleware from "./middlewares/check-chat-type.middleware";
import GeminiAPI from "./services/gemini-api";
import {Stage} from "telegraf/scenes";
import {User} from "./user";
import userFactory from "./middlewares/user-factory.meddleware";
import SceneManager from "./services/scene-manager";
import {userDreamInputSceneFactory} from "./scenes/user-dream-input.scene";
import {analyzeDreamSceneFactory} from "./scenes/analyze-dream.scene";
import {SessionManager} from "./services/session-manager";
import TelegrafI18n from "telegraf-i18n";
import path from "node:path";
import {MyContext} from "./types/context.interface";
import { selectLanguageSceneFactory } from './scenes/select-language.scene';
import {LANG} from "./constants";
import { StateMachine, UserState } from "./state-machine";


export default class DreamAnalyzerBot {
  private bot!: Telegraf<MyContext>;
    private stateMachine: StateMachine;
  
  private geminiAPI!: GeminiAPI;
  sceneManager!: SceneManager;
  private analyzeDreamStage = new Stage([
      selectLanguageSceneFactory(this),
      userDreamInputSceneFactory(this),
      analyzeDreamSceneFactory(this)
  ]);
  user!: User;

    i18n = new TelegrafI18n({
        defaultLanguage: LANG.RU, // Default language
        allowMissing: false, // Default true
        directory: path.resolve(__dirname, '..', 'src', 'locales'),
        useSession: true,
    })

    constructor() {
    this.initialize();
  }

  // Инициализация бота и его компонентов
  async initialize() {
    try {
      // Проверяем наличие токена бота
      if (!process.env.BOT_TOKEN) {
        throw new Error('BOT_TOKEN не найден в переменных окружения');
      }

      this.geminiAPI = new GeminiAPI();
      this.sceneManager = new SceneManager();

      // Создаем бота
            this.stateMachine = new StateMachine();
      
      this.bot = new Telegraf<MyContext>(process.env.BOT_TOKEN);

      // Настраиваем middleware
      this.setupMiddleware();

      // Настраиваем обработчики
      this.setupHandlers();

      console.log('Bot initialized successfully');
      
    } catch (error) {
      console.error('Error initializing bot:', error);
      process.exit(1);
    }
  }

  // Настройка middleware
  setupMiddleware() {
    const sessionManger = new SessionManager();
    this.bot.use(session());
    this.bot.use(this.i18n.middleware());
    // Логирование входящих сообщений
    this.bot.use(logProcessTimeMiddleware);
    this.bot.use(async (ctx, next) => {
        this.user = userFactory(ctx, sessionManger);
        await next();
    });

    // Middleware для проверки типа чата (только приватные сообщения)
    this.bot.use(checkChatTypeMiddleware);
    this.bot.use((ctx, next) => {
        // можно использовать Composer для более гибкой маршрутизации логики https://chatgpt.com/g/g-mzFm1dKjW-chat/c/68497323-5d34-800f-9f03-c207aa5f161b
        return this.analyzeDreamStage.middleware()(ctx, next) as any;
    });
  }

  // Настройка обработчиков команд и событий
  setupHandlers() {
     // Команда start
    this.bot.action('start', (ctx) => {
      this.stateMachine.reset();
      ctx.scene.enter('selectLanguage');

    });
    this.bot.command('start', (ctx) => {
      this.stateMachine.reset();
      ctx.scene.enter('selectLanguage');
    });
    this.bot.on('new_chat_members', (ctx) => {
      this.stateMachine.reset();
      ctx.scene.enter('selectLanguage');
    });

    // Обработка ошибок
    this.bot.catch((err: unknown, ctx) => {
      console.error('Bot error:', err);
      console.error('Update:', ctx.update);
      
      // Пытаемся уведомить пользователя об ошибке
      try {
        const message = ctx.i18n.t("requestProcessingError");
        ctx.reply(message);
        // ctx.reply('Произошла ошибка при обработке вашего запроса. Попробуйте начать заново с /start');
      } catch (replyError) {
        console.error('Error sending error notification:', replyError);
      }
    });
  }

  // Запуск бота в режиме polling
  async startPolling() {
    try {
      console.log('Starting bot in polling mode...');
      
      // Проверяем работоспособность Gemini API
      const apiHealthy = await this.geminiAPI.checkAPIHealth();
      if (!apiHealthy) {
        console.warn('Warning: Gemini API health check failed. Bot may not work properly.');
      }

      await this.bot.launch();
      console.log('Bot started successfully in polling mode');
      
      // Graceful shutdown
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));
      
    } catch (error) {
      console.error('Error starting bot:', error);
      process.exit(1);
    }
  }

  // Настройка webhook
  async setupWebhook() {
    try {
      if (!process.env.WEBHOOK_URL) {
        throw new Error('WEBHOOK_URL не найден в переменных окружения');
      }

      const port = 443; // port defined by ngrok (look at devtools)
      const webhookPath = `/webhook/${process.env.BOT_TOKEN}`;
      
      await this.bot.launch({
        webhook: {
          domain: process.env.WEBHOOK_URL,
          port: port,
          path: webhookPath
        },
      });
      
      console.log(`Webhook успешно запущен на порту ${port}`);
      return webhookPath;
    } catch (error) {
      console.error('Ошибка при настройке webhook:', error);
      throw error;
    }
  }

  // Остановка бота
  async stop(signal: string) {
    console.log(`Received ${signal}. Stopping bot...`);
    
    try {
      // Останавливаем бота
      this.bot.stop(signal);
      
      // Закрываем соединение с Redis
      if (this.user) {
        await this.user.closeDialogSession();
      }
      
      console.log('Bot stopped successfully');
      process.exit(0);
    } catch (error) {
      console.error('Error stopping bot:', error);
      process.exit(1);
    }
  }

  // Получить экземпляр бота
  getBot() {
    return this.bot;
  }

  // Получить экземпляр Gemini API
  getGeminiAPI() {
    return this.geminiAPI;
  }

  // Проверка состояния бота
  async getStatus() {
    try {
      const botInfo = await this.bot.telegram.getMe();
      const apiHealthy = await this.geminiAPI.checkAPIHealth();
      
      return {
        botActive: true,
        botUsername: botInfo.username,
        botId: botInfo.id,
        apiHealthy: apiHealthy,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      console.error('Error getting bot status:', error);
      return {
        botActive: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }
}

