/**
 * Procedural terrain explorer. Seeded noise combines coastlines, flat lowlands, and mountain ranges; a colored height mesh provides the 3D view.
 */
import * as THREE from 'three';
import { OrbitControls } from '../../Lib/Three/OrbitControls.js';
import {biomes,generateTerrain,classify,mapDimensions} from './terrain.mjs';
const canvas=document.getElementById('terrain-map');
const view=document.getElementById('terrain-view');
let renderer;
try { renderer=new THREE.WebGLRenderer({canvas,antialias:true}); }
catch(error) {
    const message=document.getElementById('scene-error');
    message.hidden=false;message.textContent='Unable to start the 3D map. Please enable WebGL in your browser.';
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--site-bg').trim());
const camera=new THREE.PerspectiveCamera(50,1,.1,2000);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.screenSpacePanning=false;
controls.minDistance=3;controls.maxDistance=500;controls.maxPolarAngle=Math.PI*.48;
scene.add(new THREE.HemisphereLight(0xffffff,0x526049,2));
const sun=new THREE.DirectionalLight(0xfff3dc,2.2);sun.position.set(-60,100,-40);scene.add(sun);
const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});
let terrain;
let mapWidth=160;
const water=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:0x3985a7,transparent:true,opacity:.68,roughness:.25,depthWrite:false}));
water.rotation.x=-Math.PI/2;water.position.y=.08;scene.add(water);
/**
 * Frame the current map size from above and reset the orbit target.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function resetView() {
    controls.target.set(0,0,0);
    const distance=mapWidth/160;
    camera.position.set(115*distance,115*distance,130*distance);
    controls.update();
}
resetView();
// Recalculate view dimensions when the surrounding layout changes.
new ResizeObserver(()=>{
    const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
}).observe(view);
// Keep visual frames separate from the simulation's own update timing.
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
/**
 * Move the camera toward or away from its target while respecting navigation limits.
 *
 * @param factor - Multiplicative change to camera distance from its orbit target.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function zoom(factor) {
    const offset=camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));
    camera.position.copy(controls.target).add(offset);controls.update();
}
document.getElementById('zoom-in').addEventListener('click',()=>zoom(.8));
document.getElementById('zoom-out').addEventListener('click',()=>zoom(1.25));
document.getElementById('reset-view').addEventListener('click',resetView);
canvas.addEventListener('pointerdown',()=>canvas.focus());
canvas.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','+','=','-'].includes(key)) return;
    event.preventDefault();
    if(key==='+'||key==='=') return zoom(.85);
    if(key==='-') return zoom(1.15);
    const forward=controls.target.clone().sub(camera.position);forward.y=0;forward.normalize();
    const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
    const step=Math.max(1,camera.position.distanceTo(controls.target)*.025)*(event.shiftKey?3:1);
    const delta=(['w','arrowup','s','arrowdown'].includes(key)?forward:right).multiplyScalar(step*(['s','arrowdown','a','arrowleft'].includes(key)?-1:1));
    // Keep the navigation target within the generated map.
    const next=controls.target.clone().add(delta);next.x=THREE.MathUtils.clamp(next.x,-mapWidth/2,mapWidth/2);next.z=THREE.MathUtils.clamp(next.z,-mapWidth/2,mapWidth/2);
    delta.subVectors(next,controls.target);controls.target.add(delta);camera.position.add(delta);controls.update();
});
const status=document.getElementById('map-status');
const download=document.getElementById('download-map');
let generation=0,generatedSeed='';
for(const biome of biomes) {
    const li=document.createElement('li'),swatch=document.createElement('span');
    swatch.className='biome-swatch';swatch.style.backgroundColor=`rgb(${biome.color.join(',')})`;
    li.append(swatch,document.createTextNode(biome.name));document.getElementById('map-legend').appendChild(li);
}
for(const id of ['scale','roughness','sea']) document.getElementById(id).addEventListener('input',event=>{
    document.getElementById(`${id}-value`).value=event.target.value+(id==='scale'?'':'%');
});
/**
 * Generate heights, rebuild the colored terrain mesh, resize water, and refresh statistics.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function generate() {
    const token=++generation;
    const scale=Number(document.getElementById('scale').value);
    const dimensions=mapDimensions(scale),size=dimensions.resolution;
    const options={seed:document.getElementById('seed').value,size,scale,roughness:Number(document.getElementById('roughness').value)/100,sea:Number(document.getElementById('sea').value)/100,island:document.getElementById('island').checked};
    status.textContent='Generating map…';download.disabled=true;
    requestAnimationFrame(()=>setTimeout(()=>{
        if(token!==generation) return;
        const {heights,counts}=generateTerrain(options);
        const sizeChanged=mapWidth!==dimensions.width;
        mapWidth=dimensions.width;
        water.scale.set(mapWidth/160,mapWidth/160,1);
        controls.maxDistance=mapWidth*4;
        camera.far=Math.max(2000,mapWidth*12);camera.updateProjectionMatrix();
        if(sizeChanged) resetView();
        const geometry=new THREE.PlaneGeometry(mapWidth,mapWidth,size-1,size-1);
        geometry.rotateX(-Math.PI/2);
        const positions=geometry.attributes.position;
        const colors=new Float32Array(size*size*3);
        for(let i=0;i<heights.length;i++) {
            positions.setY(i,(heights[i]-options.sea)*40);
            const biome=biomes[classify(heights[i],options.sea)];
            const tint=new THREE.Color(`rgb(${biome.color.join(',')})`);
            colors[i*3]=tint.r;colors[i*3+1]=tint.g;colors[i*3+2]=tint.b;
        }
        geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
        geometry.computeVertexNormals();geometry.computeBoundingSphere();
        if(terrain) {scene.remove(terrain);terrain.geometry.dispose();}
        terrain=new THREE.Mesh(geometry,terrainMaterial);scene.add(terrain);
        generatedSeed=options.seed;
        const waterPercent=Math.round((counts[0]+counts[1])/(size*size)*100);
        status.textContent=`${mapWidth} × ${mapWidth} units · ${100-waterPercent}% land · ${waterPercent}% water · Seed: ${options.seed}`;
        canvas.setAttribute('aria-label',`Interactive 3D terrain map for seed ${options.seed}. ${100-waterPercent}% land and ${waterPercent}% water. Colors identify water, beaches, plains, highlands, mountains, and snow peaks.`);
        download.disabled=false;
    },0));
}
document.getElementById('map-form').addEventListener('submit',event=>{event.preventDefault();generate();});
document.getElementById('random-seed').addEventListener('click',()=>{
    document.getElementById('seed').value=`World ${crypto.getRandomValues(new Uint32Array(1))[0]}`;generate();
});
download.addEventListener('click',()=>{
    renderer.render(scene,camera);
    canvas.toBlob(blob=>{
        if(!blob) return;
        const url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=`map-${generatedSeed.replace(/[^a-z0-9_-]/gi,'-').slice(0,60)}.png`;
        link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    },'image/png');
});
generate();
