export type BaseSceneProps={monoFontFamily:string};
export type AilyMetrics={createdAt:string;snapshotAt:string;visibility:"private";contributors:number;pullRequests:number;commits:number;trackedFiles:number};
export type AilySceneProps=BaseSceneProps&{metrics:AilyMetrics;repoUrl:string};
