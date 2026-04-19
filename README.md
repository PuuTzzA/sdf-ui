# Sdf Ui
SdfUi is a framework to easily create 3d elements from normal html elements. The scene is constructed as a [signed distance field](https://iquilezles.org/articles/distfunctions/) (sdf) which allows for easy blending between objects.

Some of the capabilities are shown [here](https://puutzza.github.io/sdf-ui/).

## Technology
SdfUi uses only html, css, javascript and webgl to create and render the scene. It is fully self-contained and has no external dependencies. 

## SdfCanvas
SdfCanvas is the central class of this framework that controlls most of the things.

### Coordinate System and Camera
Each SdfCanvas is bound to a [canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API). The origin of the created space is at the top left. The x-axis increases to the left, y-axis to the bottom and z-axis towards the user (out of the screen). 

The orthographic camera has the position (0, 0, cameraZ) and a view-direction of (0, 0, -1). 

### Usage
To use SdfUi you have to include the sdf-elments script in your html file like so:
```html
<script src="src/scripts/sdf-elements.js" type="module"></script>
```
You also have to create a canvas element and give it a unique Id:
```html
<canvas id="canvas"></canvas>
```
Then you create a script where you can create a sdf canvas out of the canvas you just created. To do that first import SdfCanvas and then create a new SdfCanvas object while passing the unique Id as a parameter.
```js
import { SdfCanvas } from "../src/scripts/sdf-ui.js";

const sdfCanvas = new SdfCanvas("canvas");
```
The SdfCanvas can accept the followng optional parameters via an options object.

```js
options = {
    renderLayers = [0],                // Which layers are rendered by this canvas (see section Render Layers)
    downscaleFactorX = 2,              // Factor to downscale the horizontal resolution
    downscaleFactorY = 2,              // Factor to downscale the vertical resolution
    topFace = false,                   // Controls if the --z value of the elements is the depth of the top-face or the center of the object
    cameraZ = 10,                      // Controls the z-coordinate of the camera
    useAA = false,                     // Enables Anti-Aliasing
    twoDMode = false,                  // Enables the 2d mode
    customShadeFunction = "",          // Custom shading function
    customElements = [],               // Definitions of custom elements
    onCompilationComplete = undefined, // Callback function for when the compilation is complete
}

// For example:
const sdfCanvas = new SdfCanvas("canvas", { downscaleFactorX: 10 });
sdfCanvas.cameraZ = 15;
```
After creating the canvas you have to call `initWegbl()` before you can draw the scene with `draw()`. 

### Public Members and Functions
```js
/**
 * This static member controlls the global layers. See section Layers for more.
 */
static layers = [
    new SdfLayer(SdfCommands.SMOOTH_UNION, 30),
]

/**
 * Boolean to check if the canvas is ready (e.g. compilation complete)
 */
get ready();

/**
 * @param {If compilation should continue even if background compilation is not available. Shold be SdfCanvas.COMPILE_POLICY_ONLY_PARALELL or SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING} compilePolicy 
 * @returns Boolean if compilation was successful
 */
async initWebgl(compilePolicy = SdfCanvas.COMPILE_POLICY_ONLY_PARALELL); /

/**
 *  * Updates the elements and renderes the scene.
 * 
 */
draw();

/**
 * Add an overwriteLayer to the SdfCanvas. This canvas will then use this overwriteLayers properties instead of the global SdfLayer properties.
 * @param {Index of the layer to overwrite} index 
 * @param {SdfLayer object that overwrites that layer} overwriteLayer 
 */
addOverwriteLayer(index, overwriteLayer);

/**
 * Removes an overwriteLayer from the SdfCanvas. 
 * @param {index of the overwriteLayer to remove} index 
 */
removeOverwriteLayer(index);
```


### Compile Time Constants
There are a few variables that can only be changesd **before** calling `initWebgl`. These are:

* **useAA:** enables Anti-Aliasing. This program uses Multisample Anti-Aliasing with four samples. 
> [!Note]
> Enabling Anti-Aliasing massively decreases performance because all calculations need to be performed four times. Additionally compile time increases when enabling it. Therefore it is suggested to only turn on Anti-Aliasing when using the 2d-mode, because there performance and compile time are massively reduced by default. 
* **twoDMode:** Enables a 2d mode, where instead of tracing a ray through the scene, the sdf is only evaluated once at a z-Depth of 0. 
* **useCustomShadeFunction:** Enables the use of a custom `shade` function to control the exact look of the scene. Otherwise the scene is shaded as described below in the Shading section. If a custom shading function is used it has to be stored as a string in the `customShadeFunction` member of the sdfCanvas object. This custom shade function takes the traced position as an input and returns the color that should be rendered at that point. It has to be of the following format:
  
```glsl
vec3 shade(Surface surface); // if twoDMode is used
vec3 shade(HitInfo hit); // if the normal 3d mode is used

// the Structs are defined as follows:
struct Surface {
    vec3 colorDiffuse;
    float kd; // diffuse material property
    vec3 colorSpecular;
    float ks; // specular material property
    vec3 colorAmbient;
    float ka; // ambient material property
    float p; // specular exponent (specular fall off)
    float mix; // mix factor
    float distance; // distance the the nearest surface
};

struct HitInfo {
    vec3 pos; // position of the surface point
    int id; // amount of steps of sphere-tracing; or -1 if it missed
    vec3 normal; // normal of the surface point
    Surface surface; // blended surface at the surface point
};

// To pass global values you can use (repurpose) the lights in the scene. These are stored in the array
vec4 lightData[MAX_NUM_LIGHTS * VEC4_PER_LIGHT]; // VEC4_PER_LIGHT is 2
uniform int uNumLights; // number of lights in the array

// you can get the values of indivicual lights like so:
int   lightIdx = 0;
vec3 lightPos   = lightData[lightIdx].xyz; // this stores the light direction if the light is a directional light
vec3 lightColor = unpackColor(lightData[dataIdx].w);
float intensity = lightData[dataIdx + 1].x;
float radius    = lightData[dataIdx + 1].y;
float lightType = lightData[dataIdx + 1].z; // 0 for point light, 1 for directional light
```
* **customElements:** You can define custom elements by setting the `customElements` member variable of the `SdfCanvas` object. This is an array of arrays of two d points that define the vertices of custom elemets in object space. See below how to use the custom elements.
```js
sdfCanvas.customElements = [
    [[-0.5, 0], [0.5, 0], [0.5, 0.5]],
    [[-1.5, 0], [1.5, 0], [0.3, 2.5], [0.1, 0.5]],
];
```
> [!Note]
> The more custom elements you define, the longer compile times will be, because each custom element adds one branch to the map funciton. Therfore you should only add the minimum amount of custom elements.


## Layers

The sdf elements are placed in layers that control how the elements are added to the scene / blended onto already existing elements in the scene. These layers are static to SdfCanvas and can be set via the static `layers` member like so:
```js
SdfCanvas.layers = [new SdfLayer(SdfCommands.SMOOTH_UNION, 100)];
```

The layer an element is on can be controled with the `data-layer-index` property of the html element. E.g.:

```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```

The layer is an index. First all elements in the lowest layer are added to the scene, then the ones from the next layer, ...

The elements are always blended with the defined `LayerOperation`:

```js
export const SdfCommands = Object.freeze({
    ...
    // Layer Operations
    UNION: 100,
    SUBTRACTION: 101,
    INTERSECTION: 102,
    XOR: 103,
    SMOOTH_UNION: 104,
    SMOOTH_SUBTRACTION: 105,
    SMOOTH_INTERSECTION: 106,
    ...
})
```

The smooth operations also have a corresponding `smoothingFactor` per layer to control the amount of smoothing.

To control the layers on a per-canvas basis you can use the `addOverwriteLayer(index, overwriteLayer)` and `removeOverwriteLayer(index)` functions that define an "overwriteLayer" at index index that is used instead of the static layer at that index.

## Render Layers

To constrain certain elements to certain canvasses, each canvas has a list of render-layer-indeces (`renderLayers`) that are compared to the render-layers of the elements. You can define those `data-reder-layers` per element like so:

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0" data-layer-index="1">Sphere</sdf-sphere>
```

An element can have multiple canvas-indices signaled by a space between the two.   

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0 1" data-layer-index="1">Sphere</sdf-sphere>
```

While rendering they now only render elements that share a common render layer. E.g. if an element has the render layers [0, 4, 5] and a canvas renderes the layers [1, 2, 3] then that canvas will not render the element. But if the canvas rendered the layers [0, 2, 3] instead the element would be rendered. 

**Lights** use the exact same principle. They also have a data-render-layers property and are only rendered by canvasses with whom they share at least one common render-layer.

By default all elements and canvasses have their render-layers set to 0 (meaning all all canvasses render everything).

## CSS Values
Most of the properties (both of geometry and shading) of the sdf elements are controled by custom css properties. This was done because then properties can easily be shared with the use of classes and animated with the build in transition and animation capabilities. 
>[!Note]
>All the custom CSS values have inherit: false. 
>To animate the custom properties you have to explicitly use `transition: --property 0.1s;` (`transition: all 0.1s;` does not work).

## Supported Elements

The position of each element is computed from its position on the page. The elements have additional properties to control their specific attributes

The z-position (the more positive the higher on the page, like z-index, but as a float) is controled by the css property **--z**. The z-value controls the z-value of the center of the object. 

All objects can be rotated, translated or skewed (in 2D or 3D) with the css `transform` property (e.g. `rotate`, `rotate3d`, `translate`, ...)

The supported primitive objects are:

> [!Important]
> For all elements with border roundings, keep in mind that in order for the element to be rendered correctly the width/height/depth has to be large enough. E.g. if you have `border-radius: 5rem;` with `width: 7rem;` then the element is not rendered correctly because it is not wide enough.

### 1. Sphere: 
A normal sphere.
```html
<sdf-sphere id="test-sdf-sphere" data-layer-index="1">Sphere</sdf-sphere>
```
* **--r:** controls the radius of the sphere.

### 2. Simple Box
A simple box with width, height and depth.
```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```
* **width, heigth:** Width and height are controled with the standard css properties widht and height
* **--depth:** Controls the depth of the box. 
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

### 3. Box
A more general box that also supports border-radius.
```html
<sdf-box id="test-sdf-box" data-layer-index="1">Box with rounded corners</sdf-box>
```
* **width, heigth, depth:** Controled in the same way as for the simple box (css properties width, height, --depth).
* **border-radius:** Controls the border radius (same as normal css). May be different for each corner.
* **--border-radius-type:** Controls the type of the radius. See [this article](https://iquilezles.org/articles/roundedboxes/) for more details. It should be one of those four options {`circle`, `parabola`, `cosine`, `cubic`}.
  * **1: Circle:** Default, normal circle (css uses this).
  * **2: Parabola:** Parabolic corner (smoother than circle).
  * **3: Cosine:** Both of the previvous solution have discontinuities in the second derivative of the normal, leading to a hard cut in the lighting. Cosing similarity fixes this by fitting a cosine to the curve. But this is **more computationally expensive** because there is no closed form solution and the result is found with binary search.
  * **4: Cubic:** Also provides continuous second derivatives (smooth lighting), also requires **binary search** to find the result.
* **--rotation-offset:** Controlls the intitial rotation of the box, i.e. axis around wich the corners are rounded. Can be {`x`, `y`, `z`}. 
  * **z:** Default, corners that are parallel to the z-axis are rounded.
  * **x:** Corners parallel to the x-axis are rounded.
  * **y:** Corners parallel to the y-axis are rounded.
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

### 4. Text
A element that contains text that which is rendered as sdf elements. As of now there is one supported font **metaballs** (only lower case letters and numbers for now). All the letters inside one sdf-text elment will have the same material and size. Sdf-text elements support `letter-spacing`, `word-spacing` and `word-break`.

```html
<sdf-text id="test-sdf-box-round" data-layer-index="1">Text</sdf-text>
```

* **--depth:** Controls the depth of the letters.
* **--letterSmoothness:** Controls the smoothing between individual letters, wich are internally combined using a `SMOOTH_UNION` function. A value of 0 means no smoothing at all.
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

### 5. Cylinder
A cylinder.

```html
<sdf-cylinder id="test-sdf-cylinder" data-layer-index="2">Cylinder</sdf-cylinder>
```
* **--axis:** Controls along which axis the cylider is formed. Can be {`x`, `y`, `z`}. Depending on this value **width**, **height** and **--depth** control the height and the radius of the cylinder.
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

### 6. Triangle
An arbitrary triangle.
```html
<sdf-triangle id="test-sdf-triangle" data-layer-index="2">Triangle</sdf-triangle>
```
* **--point-a --point-b --pointc:** The three vertices of the triangle. They are vec2s that are set like so in css:
```css
--point-a: -5rem -5rem;
--point-b: 5rem -5rem;
--point-c: 0px 5rem;
```
* **--depth:** Controls the depth of the triangle.
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

### 7. Custom Elements
Arbitrary 2d polygons that are extruded along the local z-axis. You have to define the shape before initializing the webgl canvas (see Section Compile Time Constants > Custom Elements). 

```html
<sdf-custom id="test-sdf-custom" data-custom-index="0" data-layer-index="2"></sdf-custom>
```
* **data-custom-index:** This custom attribute of the element controls which of the previously defined polygons this element should be rendered as.
* **--scale:** Controls the scale of the custom elements. E.g. if scale is set to 10rem then 1 unit of object space (the space in which you defined the polygon) will appear to be 10rem on the screen.
* **--depth:** Controls the depth of the polygon.
* **--extrude:** Extrudes all surfaces along their normal. Allows for rounded corners.

## Lights
Lights are controlled similar to elements. You have to create a html element that represents the light:
```html
<sdf-light data-render-layers="0">Directional Light</sdf-light>
```
The properties of the light are controlled by the following css properties:
* **--diffuse-color:** Color of the light.
* **--light-intensity:** Intensity of the light.
* **--light-type:** Can be `point` or `directional`. This controls if the light behaves as a point light (with a position and radius) or as a directional light (with a direction and no light falloff).
* **--light-direction:** Three component value that represents the direction of the light in case of directional lights (e.g. `--light-direction: 1 1 -1;`).
* **--radius:** The represents the radius of the light in case of a point light. Things further away than this are not illuminated by that specific point light.

## Modifiers
You can add modifiers to sdf elements to change things about them. As of now there is only one supported modifiers. You can add modifiers to elements like so:

```js
const sdfElement = document.querySelector("#element-name");
const target = document.querySelector("#target");
sdfElement.addModifier(new Twist(target));
```

### Twist
Add a twist to the selected element. The twist is controlled by a **target** element. This target element is a html-element that gets passed in the constructor. This element expects the following css properties:
* **--twist-axis:** 3d vector that controls the axis around which the twist is applied (e.g. `--twist-axis: 0 1 0;`).
* **--twist-rate:** The twist rate. This is measured in revolutions per rem. Meaning if the amount is set to 0.1 then a 10 rem big element would be twisted exactly once around --twist-axis.
* **--twist-start:** This marks the up to which distance along the twist axis the twist is applied normally. From this distance up to `--twist-end` the twist tapers of and at ...
* **--twist-end:** ... stopps entirely.

## Shading

All sdf elements should have the following css properties: 

* **--diffuse-color:** controls the `diffuseColor` ($C_d$) of the object.
* **--specular-color:** controls the `specularColor` ($C_s$) of the object.
* **--ambient-color:** controls the `ambientColor` ($C_a$) of the object.
* **--kd:** controls the diffuse parameter ($k_d$) of the object.
* **--ks:** controls the specular parameter ($k_s$) of the object.
* **--p:** controls the specular exponent ($p$) of the object.
* **--ka:** controls the ambient parameter ($k_a$) of the object.

These are used to calculate the final color ($C$) of a point on the surface with normal $\vec{n}$, vector towards the light source $\vec{l}$ view vector towards the camera $\vec{v}$. The default shading function uses the **Phong shading model** to calculate the final color:

$I_d = k_d \cdot \texttt{max}(\vec{n} \cdot \vec{l}, 0)\\
I_s = k_s \cdot \texttt{max}(\texttt{reflect}(\vec{l}, \vec{n}) \cdot \vec{v}, 0)^{p}\\
C = I_d \cdot C_d + I_s \cdot C_s + k_a \cdot C_a$

Where $\texttt{reflect}$ calculates the perfect reflection direction of $\vec{l}$ when reflected along $\vec{n}$.

This behaviour can be overwritten by defining a custom shading function (see Section Compile Time Constants).