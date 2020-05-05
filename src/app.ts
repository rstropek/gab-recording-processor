import { settings } from './settings';
import { BlobServiceClient } from '@azure/storage-blob';
import fetch from 'node-fetch';
import { SessionizeAll, ShortNameQuestion } from './sessionize';
import * as fs from 'fs';
import * as child_process from 'child_process';
import * as util from 'util';
const exists = util.promisify(fs.exists);

(async () => {
    const blobServiceClient = BlobServiceClient.fromConnectionString(settings.storageConnection);
    const containerClient = blobServiceClient.getContainerClient(settings.container);

    const trimmedRecordings: string[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.name.endsWith('RecordingTrimmed.mp4') || blob.name.endsWith('RecordingTrimmed.1.mp4')) {
            trimmedRecordings.push(blob.name);
        }
    }

    const sessions = (await (await fetch(settings.sessionizeUrl)).json()) as SessionizeAll;

    const questionId = sessions.questions.filter(q => q.question === ShortNameQuestion)[0].id;
    for (const session of sessions.sessions) {
        const qa = session.questionAnswers.filter(qa => qa.questionId === questionId)[0];
        if (!qa) continue;
        // if (qa.answerValue !== 'wie-iot-und-ml-in-produktionsumgebungen-hilft') continue;
        if (settings.skip.indexOf(qa.answerValue) !== -1) continue;
        const sessionCode = qa.answerValue;
        if (!sessionCode) continue;
        const recording = trimmedRecordings.filter(tr => tr.startsWith(sessionCode))[0];
        if (!recording) continue;
        const speakers = sessions.speakers.filter(sp => session.speakers.filter(s => s === sp.id).length > 0);

        if (await exists('./assets/recording.mp4')) {
            await fs.promises.unlink('./assets/recording.mp4');
        }

        console.log('Downloading recording...');
        const recordingClient = containerClient.getBlockBlobClient(recording);
        await recordingClient.downloadToFile('./assets/recording.mp4');
        console.log('Recording downloaded.');

        let commandLine = '[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1 [outv] [outa];';
        commandLine += '[outv]';
        commandLine += multiLineDrawText(session.title, 200, 70, settings.fontConfiguration, settings.startTitle, settings.endTitle);

        let speaker = speakers[0];
        let delta = speakers.length === 2 ? -60 : 0;
        commandLine += `,drawtext=${settings.fontConfiguration}:y=${(speaker.tagLine ? 150 : 200) + delta}:text='${speaker.firstName} ${speaker.lastName}':enable=if(gt(t\\, ${settings.startSpeaker})\\,lt(t\\, ${settings.endSpeaker}))`;
        if (speaker.tagLine) {
            commandLine += ',';
            commandLine += multiLineDrawText(speaker.tagLine, 220 + delta, 40, settings.fontConfigurationSmall, settings.startSpeaker, settings.endSpeaker);
        }

        if (speakers.length === 2) {
            speaker = speakers[1];
            delta += 230;
            commandLine += `,drawtext=${settings.fontConfiguration}:y=${(speaker.tagLine ? 150 : 200) + delta}:text='${speaker.firstName} ${speaker.lastName}':enable=if(gt(t\\, ${settings.startSpeaker})\\,lt(t\\, ${settings.endSpeaker}))`;
            if (speaker.tagLine) {
                commandLine += ',';
                commandLine += multiLineDrawText(speaker.tagLine, 220 + delta, 40, settings.fontConfigurationSmall, settings.startSpeaker, settings.endSpeaker);
            }
        }

        commandLine += '[outt]';
        if (settings.trimmed) {
            commandLine += ';[outt]trim=end=25[outc];[outa]atrim=end=25[outac]';
        }

        console.log(commandLine);

        const filename = `produced/${qa.answerValue}.mp4`;
        await execEncoding('ffmpeg', [
            '-y',
            '-i', 'assets/intro.mp4',
            '-i', './assets/recording.mp4',
            '-filter_complex', commandLine,
            '-map', settings.trimmed ? '[outc]' : '[outt]',
            '-map', settings.trimmed ? '[outac]' : '[outa]',
            `./${filename}`
        ]);

        if (settings.upload) {
            console.log('Uploading rendering result...');
            const targetFile = containerClient.getBlockBlobClient(filename);
            if (await targetFile.exists()) {
                await targetFile.delete();
            }

            await targetFile.uploadFile(`./${filename}`);
            console.log('Rendering result uploaded.');
        }

        if (settings.onlyFirst) {
            break;
        }
    }
})().then(() => console.log('Done')).catch((ex) => console.error(ex.message));

function multiLineDrawText(text: string, y: number, lineDistance: number, fontConfig: string, start: number, end: number): string {
    let titleDrawtext = '';
    for (const line of splitLines(text.replace(': ', ' - '))) {
        if (titleDrawtext) {
            titleDrawtext += ',';
        }
        titleDrawtext += `drawtext=${fontConfig}:y=${y}:text='${line}':enable=if(gt(t\\, ${start})\\,lt(t\\, ${end}))`;
        y += lineDistance;
    }
    return titleDrawtext;
}

function execEncoding(command: string, args: string[]): Promise<void> {
    return new Promise<void>((res, rej) => {
        const proc = child_process.spawn(command, args, { stdio: [process.stdin, process.stdout, process.stderr] });
        proc.on('close', (code) => {
            console.log(`ffmpeg done, response code: ${code}`);
            res();
        });
    })
}

function splitLines(text: string): string[] {
    const result: string[] = [];

    while (text) {
        if (text.length > 35) {
            const line = text.substr(0, 35);
            let blank = Math.max(line.lastIndexOf('– '), line.lastIndexOf('- '));
            if (blank === -1) {
                blank = line.lastIndexOf(' ');
            } else {
                blank++;
            }

            result.push(line.substr(0, blank === -1 ? line.length : blank));
            text = text.substr(blank === -1 ? line.length : blank + 1);
        } else {
            result.push(text);
            break;
        }
    }

    return result;
}