import { versioned } from './build.js';
/* Glurff uses the RNNoise worklet bundled by Noltbook, with its notices intact.
 * All capture and processor resources belong to one publication. */
import { noiseReduction } from 'lib/devices';
export async function processMicrophone(rawStream) {
  const raw = rawStream.getAudioTracks()[0];
  let ctx, node, source, output, closed = false, timer;
  const stopProcessor = () => { node?.port.postMessage({type:'stop'});source?.disconnect();node?.disconnect();output?.getTracks().forEach(t=>t.stop());ctx?.close().catch(()=>{}); };
  const cleanup = () => { if (closed) return;closed=true;stopProcessor();rawStream.getTracks().forEach(t=>t.stop()); };
  if (!noiseReduction() || !window.AudioWorkletNode || !window.AudioContext) return {stream:rawStream,cleanup};
  try {
    ctx = new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    await Promise.race([(async()=>{
      await ctx.resume();
      await ctx.audioWorklet.addModule(versioned('/apps/glurff/denoise-worklet.js'));
      if(closed)throw new Error('cancelled');
      node = new AudioWorkletNode(ctx,'noltbook-denoise',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
      await new Promise((resolve,reject)=>{node.port.onmessage=e=>{if(e.data?.type==='ready')resolve()};node.onprocessorerror=reject;});
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('processor-timeout')),4000)})]);
    await raw.applyConstraints({noiseSuppression:{ideal:false}}).catch(()=>{});
    source=ctx.createMediaStreamSource(rawStream);
    const dest=ctx.createMediaStreamDestination();source.connect(node).connect(dest);output=dest.stream;
    node.onprocessorerror=()=>{ if(closed)return;node.disconnect();raw.applyConstraints({noiseSuppression:{ideal:true}}).catch(()=>{});source.disconnect();source.connect(dest); };
    return {stream:output,cleanup};
  } catch {
    closed=true;stopProcessor();
    await raw.applyConstraints({noiseSuppression:{ideal:true}}).catch(()=>{});
    return {stream:rawStream,cleanup:()=>rawStream.getTracks().forEach(t=>t.stop())};
  } finally {clearTimeout(timer);}
}
