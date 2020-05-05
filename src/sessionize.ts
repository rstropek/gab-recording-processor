export const ShortNameQuestion = 'Short Link';

export interface SessionizeAll {
    sessions: Session[];
    questions: Question[];
    speakers: Speaker[];
}

interface Session {
    id: string;
    title: string;
    speakers: string[];
    questionAnswers: Answer[];
}

interface Answer {
    questionId: string;
    answerValue: string;
}

interface Question {
    id: string;
    question: string;
}

interface Speaker {
    id: string;
    firstName: string;
    lastName: string;
    profilePicture: string;
    tagLine: string;
    links: SpeakerLink[];
}

interface SpeakerLink {
    title: string;
    url: string;
    linkType: string;
}
