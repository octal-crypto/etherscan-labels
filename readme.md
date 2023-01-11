# etherscan-labels

## https://octal.art/etherscan-labels

This project scrapes address labels from Etherscan, since Etherscan doesn't expose a label API.

The data can be downloaded for offline use, and is hosted for online queries:

### List all labels:
[octal.art/etherscan-labels/labels.json
](https://octal.art/etherscan-labels/labels.json)

### Label -> addresses:
[octal.art/etherscan-labels/labels/aave.json](https://octal.art/etherscan-labels/labels/aave.json)

### Address -> labels:
[octal.art/etherscan-labels/addresses/0xffc97d72e13e01096502cb8eb52dee56f74dad7b.json](https://octal.art/etherscan-labels/addresses/0xffc97d72e13e01096502cb8eb52dee56f74dad7b.json)

### Label schema:
```
{                       
  "Label": "",          
  "Description": "",    
  "Addresses": {        
    "": {               
      "Name Tag": "",   
      "Subcategory": "",
      "Token Name": ""  
    },                  
    ...                 
  }                     
}                       
```

### Address schema:
```
{                       
  "Address": "",        
  "Labels": {           
    "": {               
      "Name Tag": "",   
      "Description": "",
      "Subcategory": "",
      "Token Name": ""  
    }                   
  }                     
}                       
```
