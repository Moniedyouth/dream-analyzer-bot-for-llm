// State machine for managing user flow
export enum UserState {
  SELECT_LANGUAGE = 'SELECT_LANGUAGE',
  INPUT_DREAM = 'INPUT_DREAM',
  ASK_QUESTIONS = 'ASK_QUESTIONS',
  ANALYZE_DREAM = 'ANALYZE_DREAM',
  COMPLETE = 'COMPLETE',
}

export class StateMachine {
  private state: UserState;

  constructor(initialState: UserState = UserState.SELECT_LANGUAGE) {
    this.state = initialState;
  }

  public getState(): UserState {
    return this.state;
  }

  public transition(nextState: UserState): void {
    this.state = nextState;
  }

  public reset(): void {
    this.state = UserState.SELECT_LANGUAGE;
  }
}
