// Shapes of the Moodle web-service responses this bot reads. Only the fields we use are typed;
// Moodle returns more. Reference: https://docs.moodle.org/dev/Web_service_API_functions

export interface SiteInfo {
  userid: number;
  fullname: string;
  release: string;
}

export interface Course {
  id: number;
  shortname: string; // "4051 - 2519063 - <name>(<group>)"; the leading number is the term code
  fullname: string;
  displayname?: string;
}

export interface ModuleContent {
  type: "file" | "url" | "content";
  filename: string;
  filepath?: string;
  filesize?: number;
  fileurl: string;
  timemodified?: number;
}

export interface Module {
  id: number; // course-module id (cmid)
  instance: number; // id inside the activity's own table (e.g. forum id)
  name: string;
  modname: string; // assign, resource, folder, url, forum, ...
  url?: string;
  description?: string;
  uservisible?: boolean;
  contents?: ModuleContent[];
}

export interface Section {
  id: number;
  name: string;
  summary?: string;
  modules: Module[];
}

export interface AssignConfig {
  plugin: string;
  subtype: string;
  name: string;
  value: string;
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  intro?: string;
  duedate: number;
  cutoffdate: number;
  configs: AssignConfig[];
  introattachments?: ModuleContent[];
}

export interface SubmissionStatus {
  lastattempt?: {
    submission?: {
      status: "new" | "draft" | "submitted" | "reopened" | string;
      plugins?: { type: string; fileareas?: { area: string; files?: ModuleContent[] }[] }[];
    };
    canedit?: boolean;
    caneditowner?: boolean;
    cansubmit?: boolean;
  };
  feedback?: { gradefordisplay?: string };
}

export interface Discussion {
  id: number;
  subject: string;
  message: string;
  timemodified: number;
}

export interface UpdateInstance {
  contextlevel: string;
  id: number;
  updates: { name: string; timeupdated: number }[];
}

export interface PopupNotification {
  id: number;
  subject: string;
  smallmessage?: string;
  contexturl?: string;
  eventtype?: string;
  timecreated: number;
  read: boolean;
}

export interface ActionEvent {
  id: number;
  name: string;
  activityname?: string;
  modulename?: string;
  timesort: number;
  url?: string;
  course?: Course;
}

export interface QrTokens {
  token: string;
  privatetoken?: string;
}
