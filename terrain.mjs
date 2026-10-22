/**
 * Deterministic terrain generation without rendering dependencies. Heights are normalized to 0–1; classify() maps height relative to sea level to a biome.
 */
export const biomes = [
    {name:'Deep water',color:[24,57,91]},
    {name:'Shallow water',color:[48,123,153]},
    {name:'Beach',color:[215,202,148]},
    {name:'Plains',color:[115,166,91]},
    {name:'Highlands',color:[83,120,73]},
    {name:'Mountains',color:[132,125,116]},
    {name:'Snow peaks',color:[231,235,230]},
];
/**
 * Hash a text seed into a repeatable integer used by the noise functions.
 *
 * @param seed - Text or integer seed used to reproduce the procedural random field.
 * @returns Unsigned integer hash for the supplied seed.
 */
function seedNumber(seed) {
    let hash=2166136261;
    for(const character of seed) hash=Math.imul(hash^character.charCodeAt(0),16777619);
    return hash>>>0;
}
/**
 * Hash an integer grid coordinate into deterministic pseudo-random noise.
 *
 * @param x - X coordinate in the operation's local coordinate system.
 * @param y - Y coordinate in the operation's local coordinate system.
 * @param seed - Text or integer seed used to reproduce the procedural random field.
 * @returns Deterministic pseudo-random scalar between zero and one.
 */
function lattice(x,y,seed) {
    let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;
    n=Math.imul(n^(n>>>13),1274126177);
    return ((n^(n>>>16))>>>0)/4294967295;
}
/**
 * Smoothly interpolate four lattice samples to avoid discontinuities between grid cells.
 *
 * @param x - X coordinate in the operation's local coordinate system.
 * @param y - Y coordinate in the operation's local coordinate system.
 * @param seed - Text or integer seed used to reproduce the procedural random field.
 * @returns Smoothly interpolated scalar noise sample between zero and one.
 */
function noise(x,y,seed) {
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    const a=lattice(ix,iy,seed),b=lattice(ix+1,iy,seed),c=lattice(ix,iy+1,seed),d=lattice(ix+1,iy+1,seed);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
/**
 * Blend several frequencies of noise; roughness controls how much fine detail survives.
 *
 * @param x - X coordinate in the operation's local coordinate system.
 * @param y - Y coordinate in the operation's local coordinate system.
 * @param seed - Text or integer seed used to reproduce the procedural random field.
 * @param roughness - Noise persistence controlling the strength of higher-frequency terrain detail.
 * @returns Weighted multi-octave noise value normalized by the total amplitude.
 */
function fractal(x,y,seed,roughness) {
    let sum=0,weight=0,amplitude=1;
    for(let octave=0;octave<6;octave++) {
        sum+=noise(x,y,seed+octave*1013)*amplitude;weight+=amplitude;
        x*=2.03;y*=2.03;amplitude*=roughness;
    }
    return sum/weight;
}
/**
 * Convert normalized elevation relative to sea level into a biome palette index.
 *
 * @param height - Normalized terrain elevation between zero and one.
 * @param sea - Normalized sea-level threshold used for water and land classification.
 * @returns Index into the biome palette for the given elevation and sea level.
 */
export function classify(height,sea) {
    if(height<sea-.13) return 0;
    if(height<sea) return 1;
    if(height<sea+.025) return 2;
    const land=(height-sea)/(1-sea);
    return land<.32?3:land<.52?4:land<.78?5:6;
}
/**
 * Blend smoothly between thresholds with zero derivative at each endpoint.
 *
 * @param low - Lower interpolation threshold.
 * @param high - Upper interpolation threshold.
 * @param value - New playback state or numeric value to be interpolated.
 * @returns Clamped smooth interpolation factor between zero and one.
 */
function smoothstep(low,high,value) {
    const t=Math.max(0,Math.min(1,(value-low)/(high-low)));
    return t*t*(3-2*t);
}
/**
 * Map terrain scale to world dimensions and a bounded sampling resolution.
 *
 * @param scale - Terrain-size setting; each scale unit spans 40 world units.
 * @returns Object containing physical map width and bounded elevation-grid resolution.
 */
export function mapDimensions(scale) {
    return {width:scale*40, resolution:Math.max(257,Math.min(769,Math.ceil(scale*16)+1))};
}
/**
 * Combine broad land, mountain masks, slope profiles, and coastal falloff into a height field.
 *
 * @param options - Configuration object.
 * @param options.seed - Text or integer seed used to reproduce the procedural random field.
 * @param options.size - Number of height samples per side of the square terrain grid. Default: 512.
 * @param options.scale - Terrain-size setting; each scale unit spans 40 world units. Default: 4.
 * @param options.roughness - Noise persistence controlling the strength of higher-frequency terrain detail. Default: .5.
 * @param options.sea - Normalized sea-level threshold used for water and land classification. Default: .42.
 * @param options.island - Whether the map applies a coastal falloff toward its edges. Default: true.
 * @returns Object containing the normalized height buffer and sample counts for each biome.
 */
export function generateTerrain({seed,size=512,scale=4,roughness=.5,sea=.42,island=true}) {
    const hash=seedNumber(seed),heights=new Float32Array(size*size);
    const counts=new Array(biomes.length).fill(0);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
        const nx=x/(size-1),ny=y/(size-1);
        const wx=noise(nx*2+40,ny*2-20,hash+17)-.5;
        const wy=noise(nx*2-50,ny*2+10,hash+29)-.5;
        const px=nx*scale+wx*.45+100, py=ny*scale+wy*.45+100;
        // Coastlines and mountain ranges have independent, broad spatial fields.
        let continent=.5+(fractal(px*.7,py*.7,hash,.25)-.5)*1.8;
        if(island) {
            const distance=Math.hypot((nx-.5)*1.65,(ny-.5)*1.65);
            continent-=smoothstep(.45,1.15,distance)*.65;
        }
        const rangeField=noise(px*.65+23,py*.65-41,hash+7919);
        const mountainMask=smoothstep(.4,.76,rangeField);
        const slopeField=noise(px*.5-13,py*.5+7,hash+3571);
        // A smooth varying exponent mixes rounded foothills and sharper ridges.
        const profile=Math.pow(mountainMask, .85+slopeField*1.8);
        const ridge=1-Math.abs(2*fractal(px*.9+8,py*.9-12,hash+2377,.28)-1);
        const detail=fractal(px*1.7,py*1.7,hash+101,roughness)-.5;
        const plain=.48+(noise(px*.55,py*.55,hash+991)-.5)*.035;
        const mountain=profile*(.28+ridge*.2)+detail*.06*profile;
        // Lowlands get very little high-frequency detail, so they are physically flat.
        const coastBlend=smoothstep(.32,.51,continent);
        let height=continent*(1-coastBlend)+(plain+mountain)*coastBlend;
        height=Math.max(0,Math.min(1,height));
        heights[y*size+x]=height;
        counts[classify(height,sea)]++;
    }
    return {heights,counts};
}
