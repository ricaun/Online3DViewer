import { Direction } from '../geometry/geometry.js';
import { ImporterBase } from './importerbase.js';
import { GetFileExtension } from '../io/fileutils.js';
import { GetExternalLibPath } from '../io/externallibs.js';
import { ConvertThreeGeometryToMesh } from '../threejs/threeutils.js';
import { ArrayBufferToUtf8String } from '../io/bufferutils.js';
import { Node, NodeType } from '../model/node.js';

import * as fflate from 'fflate';

// TODO: apply placement from Document.xml for objects

const DocumentInitResult =
{
    Success : 0,
    NoDocumentXml : 1
};

class FreeCadObject
{
    constructor (name, type)
    {
        this.name = name;
        this.type = type;
        this.shapeName = null;
        this.isVisible = false;
        this.fileName = null;
        this.fileContent = null;
        this.inLinkCount = 0;
    }

    IsConvertible ()
    {
        if (this.fileName === null || this.fileContent === null) {
            return false;
        }
        if (!this.isVisible) {
            return false;
        }
        if (this.inLinkCount > 0) {
            return false; // TODO: is this correct?
        }
        return true;
    }
}

class FreeCadDocument
{
    constructor ()
    {
        this.files = null;
        this.objectNames = [];
        this.objectData = new Map ();
    }

    Init (fileContent)
    {
        let fileContentBuffer = new Uint8Array (fileContent);
        this.files = fflate.unzipSync (fileContentBuffer);
        if (!this.LoadDocumentXml ()) {
            return DocumentInitResult.NoDocumentXml;
        }

        this.LoadGuiDocumentXml ();
        return DocumentInitResult.Success;
    }

    GetObjectListToConvert ()
    {
        let objectList = [];
        for (let objectName of this.objectNames) {
            let object = this.objectData.get (objectName);
            if (!object.IsConvertible ()) {
                continue;
            }
            objectList.push (object);
        }
        return objectList;
    }

    IsSupportedType (type)
    {
        // TODO: is this correct?
        if (!type.startsWith ('Part::') && !type.startsWith ('PartDesign::')) {
            return false;
        }
        if (type.indexOf ('Part2D') !== -1) {
            return false;
        }
        return true;
    }

    HasFile (fileName)
    {
        return (fileName in this.files);
    }

    LoadDocumentXml ()
    {
        let documentXml = this.GetXMLContent ('Document.xml');
        if (documentXml === null) {
            return false;
        }

        let objectsElements = documentXml.getElementsByTagName ('Objects');
        for (let objectsElement of objectsElements) {
            let objectElements = objectsElement.getElementsByTagName ('Object');
            for (let objectElement of objectElements) {
                let name = objectElement.getAttribute ('name');
                let type = objectElement.getAttribute ('type');
                if (!this.IsSupportedType (type)) {
                    continue;
                }
                let object = new FreeCadObject (name, type);
                this.objectNames.push (name);
                this.objectData.set (name, object);
            }
        }

        let objectDataElements = documentXml.getElementsByTagName ('ObjectData');
        for (let objectDataElement of objectDataElements) {
            let objectElements = objectDataElement.getElementsByTagName ('Object');
            for (let objectElement of objectElements) {
                let name = objectElement.getAttribute ('name');
                if (!this.objectData.has (name)) {
                    continue;
                }

                let object = this.objectData.get (name);
                let propertyElements = objectElement.getElementsByTagName ('Property');
                for (let propertyElement of propertyElements) {
                    let propertyName = propertyElement.getAttribute ('name');
                    if (propertyName === 'Label') {
                        object.shapeName = this.GetFirstChildValue (propertyElement, 'String', 'value');
                    } else if (propertyName === 'Visibility') {
                        let isVisibleString = this.GetFirstChildValue (propertyElement, 'Bool', 'value');
                        object.isVisible = (isVisibleString === 'true');
                    } else if (propertyName === 'Visible') {
                        let isVisibleString = this.GetFirstChildValue (propertyElement, 'Bool', 'value');
                        object.isVisible = (isVisibleString === 'true');
                    } else if (propertyName === 'Shape') {
                        let fileName = this.GetFirstChildValue (propertyElement, 'Part', 'file');
                        if (!this.HasFile (fileName)) {
                            continue;
                        }
                        let extension = GetFileExtension (fileName);
                        if (extension !== 'brp' && extension !== 'brep') {
                            continue;
                        }
                        object.fileName = fileName;
                        object.fileContent = this.files[fileName];
                    }
                }

                let linkElements = objectElement.getElementsByTagName ('Link');
                for (let linkElement of linkElements) {
                    let linkedName = linkElement.getAttribute ('value');
                    if (this.objectData.has (linkedName)) {
                        let linkedObject = this.objectData.get (linkedName);
                        linkedObject.inLinkCount += 1;
                    }
                }
            }
        }

        return true;
    }

    LoadGuiDocumentXml ()
    {
        let documentXml = this.GetXMLContent ('GuiDocument.xml');
        if (documentXml === null) {
            return false;
        }

        let viewProviderElements = documentXml.getElementsByTagName ('ViewProvider');
        for (let viewProviderElement of viewProviderElements) {
            let name = viewProviderElement.getAttribute ('name');
            if (!this.objectData.has (name)) {
                continue;
            }

            let object = this.objectData.get (name);
            let propertyElements = viewProviderElement.getElementsByTagName ('Property');
            for (let propertyElement of propertyElements) {
                let propertyName = propertyElement.getAttribute ('name');
                if (propertyName === 'Visibility') {
                    let isVisibleString = this.GetFirstChildValue (propertyElement, 'Bool', 'value');
                    object.isVisible = (isVisibleString === 'true');
                }
            }
        }

        return true;
    }

    GetXMLContent (xmlFileName)
    {
        if (!this.HasFile (xmlFileName)) {
            return null;
        }

        let xmlParser = new DOMParser ();
        let xmlString = ArrayBufferToUtf8String (this.files[xmlFileName]);
        return xmlParser.parseFromString (xmlString, 'text/xml');
    }

    GetFirstChildValue (element, childTagName, childAttribute)
    {
        let childObjects = element.getElementsByTagName (childTagName);
        if (childObjects.length === 0) {
            return null;
        }
        return childObjects[0].getAttribute (childAttribute);
    }
}

export class ImporterFcstd extends ImporterBase
{
    constructor ()
    {
        super ();
        this.worker = null;
        this.document = null;
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
        this.document = null;
	}

    ResetContent ()
    {
        this.worker = null;
        this.document = new FreeCadDocument ();
    }

    ImportContent (fileContent, onFinish)
    {
        let result = this.document.Init (fileContent);
        if (result === DocumentInitResult.NoDocumentXml) {
            this.SetError ('No Document.xml found.');
            onFinish ();
            return;
        }
        let objectsToConvert = this.document.GetObjectListToConvert ();
        this.ConvertObjects (objectsToConvert, onFinish);
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
        };

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
        if (!resultContent.success || resultContent.meshes.length === 0) {
            return;
        }

        let objectNode = new Node ();
        objectNode.SetType (NodeType.GroupNode);
        if (object.shapeName !== null) {
            objectNode.SetName (object.shapeName);
        }

        let objectMeshIndex = 1;
        for (let resultMesh of resultContent.meshes) {
            let mesh = ConvertThreeGeometryToMesh (resultMesh, null);
            if (object.shapeName !== null) {
                let indexString = objectMeshIndex.toString ().padStart (3, '0');
                mesh.SetName (object.shapeName + ' ' + indexString);
            }
            let meshIndex = this.model.AddMesh (mesh);
            objectNode.AddMeshIndex (meshIndex);
            objectMeshIndex += 1;
        }

        let rootNode = this.model.GetRootNode ();
        rootNode.AddChildNode (objectNode);
    }
}
