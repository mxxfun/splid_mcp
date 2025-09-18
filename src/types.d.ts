declare module 'splid-js' {
  export class SplidClient {
    constructor(options?: any);
    static getBalance: any;
    group: {
      getByInviteCode: (code: string) => Promise<{ result: { objectId: string } }>;
      create: (...args: any[]) => Promise<any>;
    };
    groupInfo: any;
    person: any;
    entry: any;
  }
}
