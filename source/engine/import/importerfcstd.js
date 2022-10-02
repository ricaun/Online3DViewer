import { Direction } from '../geometry/geometry.js';
import { ImporterBase } from './importerbase.js';
import { GetFileExtension } from '../io/fileutils.js';
import { GetExternalLibPath } from '../io/externallibs.js';
import { ConvertThreeGeometryToMesh } from '../threejs/threeutils.js';
import { ArrayBufferToUtf8String } from '../io/bufferutils.js';
import { Node, NodeType } from '../model/node.js';

import * as fflate from 'fflate';

export class ImporterFcstd extends ImporterBase
{
    constructor ()
    {
        super ();
        this.worker = null;
    }

    CanImportExtension (extension)
    {
        return extension === 'fcstd';
    }

    GetUpDirection ()
    {
        return Direction.Z;
    }

	ClearContent ()
	{
        if (this.worker !== null) {
            this.worker.terminate ();
            this.worker = null;
        }
	}

    ResetContent ()
    {
        this.worker = null;
    }

    ImportContent (fileContent, onFinish)
    {
        let objectsToImport = this.CollectObjectsToImport (fileContent);
        if (objectsToImport.length === 0) {
            onFinish ();
            return;
        }

        this.ConvertObjects (objectsToImport, onFinish);
    }

    ConvertObjects (objects, onFinish)
    {
        let workerPath = GetExternalLibPath ('loaders/occt-import-js-worker.js');
        this.worker = new Worker (workerPath);

        let convertedObjectCount = 0;
        let onFileConverted = (resultContent) => {
            if (resultContent !== null) {
                let currentObject = objects[convertedObjectCount];
                this.OnFileConverted (currentObject, resultContent);
            }
            convertedObjectCount += 1;
            if (convertedObjectCount === objects.length) {
                onFinish ();
            } else {
                let currentObject = objects[convertedObjectCount];
                this.worker.postMessage ({
                    format : 'brep',
                    buffer : currentObject.fileContent
                });
            }
        }

        this.worker.addEventListener ('message', (ev) => {
            onFileConverted (ev.data);
        });

        this.worker.addEventListener ('error', (ev) => {
            onFileConverted (null);
        });

        let currentObject = objects[convertedObjectCount];
        this.worker.postMessage ({
            format : 'brep',
            buffer : currentObject.fileContent
        });
    }

    OnFileConverted (object, resultContent)
    {
        if (!resultContent.success) {
            return;
        }

        let objectNode = new Node ();
        if (object.shapeName !== null) {
            objectNode.SetName (object.shapeName);
        }
        objectNode.SetType (NodeType.GroupNode);
        for (let resultMesh of resultContent.meshes) {
            let mesh = ConvertThreeGeometryToMesh (resultMesh, null);
            let meshIndex = this.model.AddMesh (mesh);
            objectNode.AddMeshIndex (meshIndex);
        }
        let rootNode = this.model.GetRootNode ();
        rootNode.AddChildNode (objectNode);
    }

    CollectObjectsToImport (fileContent)
    {
        function GetFirstChildValue (element, childTagName, childAttribute)
        {
            let childObjects = element.getElementsByTagName (childTagName);
            if (childObjects.length === 0) {
                return null;
            }
            return childObjects[0].getAttribute (childAttribute);
        }

        let objectsToImport = [];
        let fileContentBuffer = new Uint8Array (fileContent);
        let decompressedFiles = fflate.unzipSync (fileContentBuffer);

        let documentXml = this.GetXMLContent (decompressedFiles, 'Document.xml');
        if (documentXml === null) {
            this.SetError ('No Document.xml found.');
            return objectsToImport;
        }

        let rootObjects = this.GetRootObjectsFromDocumentXml (documentXml);
        let objectDataElems = documentXml.getElementsByTagName ('ObjectData');
        for (let objectDataElem of objectDataElems) {
            let objectElems = objectDataElem.getElementsByTagName ('Object');
            for (let objectElem of objectElems) {
                let objectName = objectElem.getAttribute ('name');
                if (!rootObjects.has (objectName)) {
                    continue;
                }

                let objectData = {
                    shapeId : objectName,
                    isVisible : true,
                    shapeName : null,
                    fileName : null,
                    fileContent : null
                };

                let propertyObjects = objectElem.getElementsByTagName ('Property');
                for (let propertyObject of propertyObjects) {
                    let propertyName = propertyObject.getAttribute ('name');
                    if (propertyName === 'Label') {
                        objectData.shapeName = GetFirstChildValue (propertyObject, 'String', 'value');
                    } else if (propertyName === 'Visibility') {
                        let isVisibleString = GetFirstChildValue (propertyObject, 'Bool', 'value');
                        objectData.isVisible = (isVisibleString === 'true');
                    } else if (propertyName === 'Shape') {
                        let fileName = GetFirstChildValue (propertyObject, 'Part', 'file');
                        if (!(fileName in decompressedFiles)) {
                            continue;
                        }
                        let extension = GetFileExtension (fileName);
                        if (extension != 'brp' && extension != 'brep') {
                            continue;
                        }
                        objectData.fileName = fileName;
                        objectData.fileContent = decompressedFiles[fileName];
                    }
                }

                if (!objectData.isVisible || objectData.fileContent === null) {
                    continue;
                }
                objectsToImport.push (objectData);
            }
        }

        if (objectsToImport.length === 0) {
            this.SetError ('No objects found for import.');
            return objectsToImport;
        }

        return objectsToImport;
    }

    GetXMLContent (decompressedFiles, xmlFileName)
    {
        let documentXmlName = 'Document.xml';
        if (!(xmlFileName in decompressedFiles)) {
            return null;
        }

        let xmlParser = new DOMParser ();
        let xmlString = ArrayBufferToUtf8String (decompressedFiles[documentXmlName]);
        return xmlParser.parseFromString (xmlString, 'text/xml');
    }

    GetRootObjectsFromDocumentXml (documentXml)
    {
        function IsPartObject (objectType) {
            return objectType.startsWith ('Part');
        }

        let partObjects = new Set ();
        let rootObjects = new Set ();

        let objectsElems = documentXml.getElementsByTagName ('Objects');
        for (let objectsElem of objectsElems) {
            let objectElems = objectsElem.getElementsByTagName ('Object');
            for (let objectElem of objectElems) {
                let objectName = objectElem.getAttribute ('name');
                let objectType = objectElem.getAttribute ('type');
                if (IsPartObject (objectType)) {
                    rootObjects.add (objectName);
                    partObjects.add (objectName);
                }
            }
        }

        let objectDataElems = documentXml.getElementsByTagName ('ObjectData');
        for (let objectDataElem of objectDataElems) {
            let objectElems = objectDataElem.getElementsByTagName ('Object');
            for (let objectElem of objectElems) {
                let objectName = objectElem.getAttribute ('name');
                if (!partObjects.has (objectName)) {
                    continue;
                }
                let linkElems = objectElem.getElementsByTagName ('Link');
                for (let linkElem of linkElems) {
                    let linkedObject = linkElem.getAttribute ('value');
                    if (rootObjects.has (linkedObject)) {
                        rootObjects.delete (linkedObject);
                    }
                }
            }
        }

        return rootObjects;
    }
}
